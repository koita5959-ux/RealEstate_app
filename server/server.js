// RealEstate_app の小さな API サーバー。
// 役割: 利用者画面からの相談を Claude に渡し、返事と「1往復ごとの記録」を残す。
// 守り: 停止スイッチ / 1日の費用上限 / 利用回数の制限 / 入力の長さ制限 / キーはファイルから読む。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { adminHandler, publicStats, summarize } from "./admin.js";

const env = process.env;
const PORT = Number(env.PORT || 3000);
const MODEL = env.MODEL || "claude-opus-5-5";
const MAX_TOKENS = Number(env.MAX_TOKENS || 2000); // Opus 5.5 は考える処理を止められず、その分もここに入る。600では考えるだけで使い切り、返事が空になったことがある（2026-11-07）
const EFFORT = env.EFFORT || "low"; // 雑談は浅くてよい。深くすると費用と時間が増える
const DAILY_USD_CAP = Number(env.DAILY_USD_CAP || 2); // 1日の推定費用の上限（超えたら止まる）
const RATE_PER_MIN = Number(env.RATE_PER_MIN || 12); // 同じ人の1分あたりの上限
const MAX_INFLIGHT = Number(env.MAX_INFLIGHT || 4); // 同時に処理する数
const KEY_FILE = env.KEY_FILE || "/run/secrets/anthropic_api_key";
const DATA_DIR = env.DATA_DIR || "/data";
const ADMIN_PASSWORD_FILE = env.ADMIN_PASSWORD_FILE || "/run/secrets/admin_password";
const SYSTEM_PROMPT = fs.readFileSync(new URL("./system.txt", import.meta.url), "utf8").trim();

// 価格（USD / 100万トークン）。推定用。Console の請求額が正。
const PRICES = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-fable-5-1": { in: 10, out: 50 },
};
const price = PRICES[MODEL] || { in: 0, out: 0 };
const estimateUsd = (u) =>
  ((u.input_tokens || 0) * price.in + (u.output_tokens || 0) * price.out) / 1e6;

// ---- キー（ファイルから。中身はログにも画面にも出さない）----
let apiKey = "";
try {
  apiKey = fs.readFileSync(KEY_FILE, "utf8").trim();
} catch {
  /* なければ空のまま */
}
const client = apiKey ? new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }) : null;

// ---- 記録（1往復ごと 1行の JSON）----
fs.mkdirSync(DATA_DIR, { recursive: true });
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const logPath = (d = today()) => path.join(DATA_DIR, `log-${d}.jsonl`);
// ---- 集計の保存：動き（記録の書き込み）があるたびに作り直し、開発の利用状況は保存した集計を返すだけ（開くときに計算しない） ----
let snap = null, snapTimer = null, snapDay = "", changeSeq = 0; // changeSeq：記録が書かれるたびに増える数（開発利用状況が「変わったか」を聞く）
function rebuild() {
  try { snap = summarize(adminCtx); snapDay = today(); } catch (e) { console.error("summarize failed:", e.message); }
}
function touchSnap() { // 連続した動きは1秒にまとめて、1回だけ作り直す
  changeSeq++;
  if (snapTimer) return;
  snapTimer = setTimeout(() => { snapTimer = null; rebuild(); }, 1000);
}
function writeLog(rec) {
  try {
    fs.appendFileSync(logPath(), JSON.stringify(rec) + "\n", { mode: 0o600 });
  } catch (e) {
    console.error("log write failed:", e.message);
  }
  touchSnap();
}

// 今日の費用を、起動時に記録から復元する
let spentDate = today();
let spentUsd = 0;
function loadSpent() {
  spentDate = today();
  spentUsd = 0;
  try {
    for (const line of fs.readFileSync(logPath(), "utf8").split("\n")) {
      if (!line) continue;
      try {
        spentUsd += JSON.parse(line).costUsd || 0;
      } catch {
        /* 壊れた行は飛ばす */
      }
    }
  } catch {
    /* ファイルなし */
  }
}
loadSpent();

// ---- 停止スイッチ: DISABLED=1、または data/DISABLED というファイルがあれば止まる ----
const disabled = () => env.DISABLED === "1" || fs.existsSync(path.join(DATA_DIR, "DISABLED"));

// ---- 利用回数の制限（メモリ内）----
const hits = new Map();
function rateLimited(who) {
  const now = Date.now();
  const arr = (hits.get(who) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(who, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_PER_MIN;
}

let inflight = 0;

// ---- 入力の検査 ----
const clip = (s, n) => String(s ?? "").slice(0, n);
function parseBody(body) {
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: clip(m.content, 2000) }))
    .filter((m) => m.content.trim());
  if (!clean.length || clean[clean.length - 1].role !== "user") return null;
  const m = body.meta && typeof body.meta === "object" ? body.meta : {};
  const meta = {}; // 画面から添えられる「何を押したか」。分析用（信頼はしない）
  for (const k of ["q", "press", "typed", "branch", "place", "near", "road", "intent", "kind"]) {
    if (m[k] !== undefined) meta[k] = typeof m[k] === "number" || typeof m[k] === "boolean" ? m[k] : clip(m[k], 80);
  }
  return {
    meta,
    sid: clip(body.sid, 64) || "no-sid",
    by: clip(body.by, 32) || "visitor",
    context: clip(body.context, 2000),
    messages: clean,
  };
}

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(s);
}

async function readBody(req, limit = 32_768) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("too large"), { code: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// 拒否の記録は、同じ人からの連打で記録が溢れないよう、1分に1回までにする
const rejLogged = new Map();
async function handleChat(req, res) {
  const t0 = Date.now();
  const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12); // IP そのものは残さない
  const base = { ts: new Date().toISOString(), who, model: MODEL };

  let input;
  try {
    input = parseBody(await readBody(req));
  } catch (e) {
    return send(res, e.code === 413 ? 413 : 400, { error: "bad_request" });
  }
  if (!input) return send(res, 400, { error: "bad_request" });

  const userText = input.messages[input.messages.length - 1].content;
  const turn = input.messages.filter((m) => m.role === "user").length;
  const reject = (code, reason) => {
    const k = who + reason;
    if (Date.now() - (rejLogged.get(k) || 0) > 60_000) {
      rejLogged.set(k, Date.now());
      if (rejLogged.size > 2000) rejLogged.clear();
      writeLog({ ...base, sid: input.sid, by: input.by, turn, userText: clip(userText, 200), meta: input.meta, status: "rejected", reason, costUsd: 0 });
    }
    return send(res, code, { error: reason });
  };
  if (disabled()) return reject(503, "disabled");
  if (!client) return reject(503, "no_key");
  if (today() !== spentDate) loadSpent();
  if (spentUsd >= DAILY_USD_CAP) return reject(429, "daily_cap");
  if (rateLimited(who)) return reject(429, "rate_limited");
  if (inflight >= MAX_INFLIGHT) return reject(429, "busy");

  const system = input.context ? `${SYSTEM_PROMPT}\n\n【画面から渡された状況】\n${input.context}` : SYSTEM_PROMPT;
  const rec = { ...base, sid: input.sid, by: input.by, turn, context: input.context, userText, meta: input.meta };

  inflight++;
  try {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      output_config: { effort: EFFORT },
      messages: input.messages,
    });
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const usage = r.usage || {};
    const costUsd = estimateUsd(usage);
    spentUsd += costUsd;
    writeLog({
      ...rec,
      status: "ok",
      stopReason: r.stop_reason,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheCreate: usage.cache_creation_input_tokens || 0,
      costUsd,
      ms: Date.now() - t0,
      reply: text,
    });
    return send(res, 200, {
      text,
      stopReason: r.stop_reason,
      usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
      costUsdEstimate: costUsd,
      ms: Date.now() - t0,
    });
  } catch (e) {
    writeLog({ ...rec, status: "error", httpStatus: e.status || 0, error: clip(e.message, 300), costUsd: 0, ms: Date.now() - t0 });
    return send(res, 502, { error: "upstream", httpStatus: e.status || 0 });
  } finally {
    inflight--;
  }
}

// ---- 画面の動き（開いた・地図・ピン・押したボタン・閉じた）。AI を呼ばない①〜③も含め、どこまで進んだかを残す ----
const EVENT_TYPES = new Set(["open", "map", "pin", "evaluate", "choice", "inquiry_open", "inquiry_send", "rewind", "end"]);
const evHits = new Map();
async function handleEvent(req, res) {
  const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
  const now = Date.now();
  const arr = (evHits.get(who) || []).filter((t) => now - t < 60_000);
  arr.push(now); evHits.set(who, arr); if (evHits.size > 5000) evHits.clear();
  if (arr.length > 120) return send(res, 429, { error: "rate_limited" });
  let b;
  try { b = await readBody(req, 4096); } catch { return send(res, 400, { error: "bad_request" }); }
  if (!EVENT_TYPES.has(b.type)) return send(res, 400, { error: "bad_type" });
  const data = {};
  if (b.data && typeof b.data === "object") for (const [k, v] of Object.entries(b.data).slice(0, 8)) data[clip(k, 20)] = typeof v === "number" || typeof v === "boolean" ? v : clip(v, 80);
  try {
    fs.appendFileSync(path.join(DATA_DIR, `events-${today()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), who, sid: clip(b.sid, 64) || "no-sid", by: clip(b.by, 32) || "visitor", type: b.type, data }) + "\n", { mode: 0o600 });
  } catch (e) { console.error("event write failed:", e.message); }
  touchSnap();
  return send(res, 204, {});
}

// ---- セッションの記録（再表示用）：画面が送る「構造化した状態」だけを、無害な形に整えて保存する（HTMLは受け取らない） ----
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch { /* 後で書くときに失敗として記録 */ }
const num = (v) => (Number.isFinite(+v) ? +v : 0);
function cleanState(s) {
  s = s && typeof s === "object" ? s : {};
  const sheet = {};
  for (const [k, v] of Object.entries(s.sheet && typeof s.sheet === "object" ? s.sheet : {}).slice(0, 24)) sheet[clip(k, 24)] = v == null ? null : clip(v, 400);
  const p = s.pub && typeof s.pub === "object" ? s.pub : {};
  return {
    updated: num(s.updated), stage: clip(s.stage, 40), place: clip(s.place, 80), near: clip(s.near, 40), localKnowledge: clip(s.localKnowledge, 300), revised: clip(s.revised, 200),
    path: (Array.isArray(s.path) ? s.path : []).slice(0, 40).map((x) => ({ press: clip(x?.press, 80), q: num(x?.q) | 0, opt: num(x?.opt) | 0, type: clip(x?.type, 300) })),
    sheet, signals: (Array.isArray(s.signals) ? s.signals : []).slice(0, 20).map((x) => clip(x, 200)),
    usage: { n: num(s.usage?.n), tin: num(s.usage?.tin), tout: num(s.usage?.tout), costUsd: num(s.usage?.costUsd) },
    pub: p.ready ? { ready: true, avgUsd: num(p.avgUsd), p90Usd: num(p.p90Usd), sessions: num(p.sessions), usdJpy: num(p.usdJpy) || 150 } : { ready: false, usdJpy: num(p.usdJpy) || 150 },
  };
}
// スナップショット（その時の会話欄の中身を、データとして）：種類・件数・文字数を絞って保存する。HTMLの要素は受け取らず、戻すときに画面側が決まった要素だけを作り直す
function cleanSnapshot(x) {
  if (!x || typeof x !== "object") return null;
  const talk = (Array.isArray(x.talk) ? x.talk : []).slice(0, 80).map((it) => {
    if (it?.t === "ai") return { t: "ai", html: clip(it.html, 4000), will: clip(it.will, 800) };
    if (it?.t === "me") return { t: "me", text: clip(it.text, 600) };
    if (it?.t === "inq") return { t: "inq", q: num(it.q) | 0, sent: !!it.sent, way: clip(it.way, 20) }; // お問い合わせは「送ったか」と連絡の希望だけ（お名前・連絡先は受け取らない）
    if (it?.t === "row") return { t: "row", q: num(it.q) | 0, step: it.step == null ? null : num(it.step) | 0, done: !!it.done, hasText: !!it.hasText, buttons: (Array.isArray(it.buttons) ? it.buttons : []).slice(0, 14).map((b) => ({ c: clip(b?.c, 80), opt: num(b?.opt) | 0, chosen: !!b?.chosen })) };
    return null;
  }).filter(Boolean);
  return { v: 1, talk, pin: { lat: num(x.pin?.lat), lng: num(x.pin?.lng) }, area: num(x.area) | 0, place: clip(x.place, 80), near: clip(x.near, 40) };
}
const sessHits = new Map();
async function handleSession(req, res) {
  const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
  const now = Date.now();
  const arr = (sessHits.get(who) || []).filter((t) => now - t < 60_000);
  arr.push(now); sessHits.set(who, arr); if (sessHits.size > 5000) sessHits.clear();
  if (arr.length > 60) return send(res, 429, { error: "rate_limited" });
  let b;
  try { b = await readBody(req, 262_144); } catch { return send(res, 400, { error: "bad_request" }); }
  const sid = String(b.sid || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return send(res, 400, { error: "bad_sid" });
  // 復元したもの（reconstructed）は、元のセッションの時刻を残せる
  const savedAt = b.reconstructed && /^\d{4}-\d\d-\d\dT[\d:.]{8,12}Z$/.test(String(b.savedAt || "")) ? String(b.savedAt) : new Date().toISOString();
  const rec = { sid, by: clip(b.by, 32) || "visitor", savedAt, state: cleanState(b.state), snapshot: cleanSnapshot(b.snapshot), reconstructed: !!b.reconstructed };
  try {
    const f = path.join(SESSIONS_DIR, sid + ".json");
    fs.writeFileSync(f + ".tmp", JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(f + ".tmp", f);
  } catch (e) { console.error("session write failed:", e.message); return send(res, 500, { error: "server" }); }
  touchSnap();
  return send(res, 204, {});
}

// ---- 管理画面の用意 ----
const adminHits = [];
const adminCtx = {
  DATA_DIR, MODEL, DAILY_USD_CAP, PRICES, ADMIN_PASSWORD_FILE, readBody, disabled,
  getSpent: () => (today() === spentDate ? spentUsd : 0),
  // 読むとき：反映待ちの動き（1秒のまとめ待ち）があれば先に作り直す。リロードすれば、それまでの動きが必ず入った集計になる
  getSnapshot: () => { if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; rebuild(); } else if (!snap) rebuild(); return snap; },
  refresh: () => { changeSeq++; rebuild(); },
  getSeq: () => changeSeq,
  adminRate: () => { const n = Date.now(); while (adminHits.length && n - adminHits[0] > 60_000) adminHits.shift(); adminHits.push(n); return adminHits.length <= 120; },
};

rebuild(); // 起動時に1回
setInterval(() => { if (today() !== snapDay) rebuild(); }, 5 * 60_000); // 日が替わったときだけ、日付の集計を作り直す

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, enabled: !disabled(), keyConfigured: !!client, model: MODEL });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "POST" && url.pathname === "/api/event") return await handleEvent(req, res);
    if (req.method === "POST" && url.pathname === "/api/session") return await handleSession(req, res);
    if (req.method === "GET" && url.pathname === "/api/public-stats") return send(res, 200, publicStats(adminCtx));
    if (await adminHandler(req, res, url, adminCtx)) return;
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("unhandled:", e.message);
    return send(res, 500, { error: "server" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`api listening :${PORT} model=${MODEL} key=${client ? "set" : "missing"} cap=$${DAILY_USD_CAP}/day`);
});
