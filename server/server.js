// RealEstate_app の小さな API サーバー。
// 役割: 利用者画面からの相談を Claude に渡し、返事と「1往復ごとの記録」を残す。
// 守り: 停止スイッチ / 1日の費用上限 / 利用回数の制限 / 入力の長さ制限 / キーはファイルから読む。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { adminHandler, publicStats, summarize } from "./admin.js";
import { landSetup } from "./land.js";
import { read as readSite } from "./shop/read.js";
import { understand } from "./shop/understand.js";

const env = process.env;
const PORT = Number(env.PORT || 3000);
const MODEL = env.MODEL || "claude-opus-5-5";
const MAX_TOKENS = Number(env.MAX_TOKENS || 2000); // Opus 5.5 は考える処理を止められず、その分もここに入る。600では考えるだけで使い切り、返事が空になったことがある（2026-11-07）
const EFFORT = env.EFFORT || "low"; // 雑談は浅くてよい。深くすると費用と時間が増える
const DAILY_USD_CAP = Number(env.DAILY_USD_CAP || 2); // 1日の推定費用の上限（超えたら止まる）。初期値。開発利用状況の「設定」で変えると data/limits.json が優先
const RATE_PER_MIN = Number(env.RATE_PER_MIN || 12); // 同じ人の1分あたりの上限
const MAX_INFLIGHT = Number(env.MAX_INFLIGHT || 4); // 同時に処理する数。初期値。data/limits.json が優先
const QUEUE_WAIT_MS = Number(env.QUEUE_WAIT_MS || 25_000); // 混んでいるとき、空くまで待つ長さ（画面は60秒で諦めるので、その内側）
const QUEUE_MAX = 50; // 待てる人数。これを超えたら「混み合っています」
const KEY_FILE = env.KEY_FILE || "/run/secrets/anthropic_api_key";
const DATA_DIR = env.DATA_DIR || "/data";
const ADMIN_PASSWORD_FILE = env.ADMIN_PASSWORD_FILE || "/run/secrets/admin_password";
const LAND_KEY_FILE = env.LAND_KEY_FILE || "/run/secrets/reinfolib_api_key"; // 不動産情報ライブラリ。なければ見本の値
const MAP_KEY_FILE = env.MAP_KEY_FILE || "/run/secrets/google_maps_embed_key"; // Google の Maps Embed API（ストリートビュー）。画面に渡す種類のキーで、使えるサイトを Google 側で限定してある
const SYSTEM_PROMPT = fs.readFileSync(new URL("./system.txt", import.meta.url), "utf8").trim();
const SYSTEM_TALK = fs.readFileSync(new URL("./system_talk.txt", import.meta.url), "utf8").trim(); // 2 対話型・外野目線（初期）
const SYSTEM_TALK_STAFF = fs.readFileSync(new URL("./system_talk_staff.txt", import.meta.url), "utf8").trim(); // 2 対話型・社員目線（店が選ぶ）

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
// 上限（1日の費用・同時件数）：開発利用状況から変えられる。再起動なしで、次の問い合わせから効く
const LIMITS_FILE = () => path.join(DATA_DIR, "limits.json");
let limitsCache = null, limitsAt = 0;
function limits() {
  if (limitsCache && Date.now() - limitsAt < 2000) return limitsCache;
  let j = {};
  try { j = JSON.parse(fs.readFileSync(LIMITS_FILE(), "utf8")); } catch { /* まだ変えていない */ }
  limitsCache = { dailyCap: j.dailyCap > 0 ? j.dailyCap : DAILY_USD_CAP, maxInflight: j.maxInflight >= 1 ? j.maxInflight : MAX_INFLIGHT,
    maxUsers: j.maxUsers >= 1 ? j.maxUsers : 10, dailySessions: j.dailySessions >= 1 ? j.dailySessions : 50, history: Array.isArray(j.history) ? j.history : [] };
  limitsAt = Date.now();
  return limitsCache;
}
function setLimits(v) {
  const cur = limits(), keys = ["dailyCap", "maxInflight", "maxUsers", "dailySessions"];
  const now = Object.fromEntries(keys.map((k) => [k, v[k]])), before = Object.fromEntries(keys.map((k) => [k, cur[k]]));
  const history = [{ ts: new Date().toISOString(), ...now, before }, ...cur.history].slice(0, 30);
  fs.writeFileSync(LIMITS_FILE(), JSON.stringify({ ...now, history }, null, 1), { mode: 0o600 });
  limitsCache = null;
  drainQueue();
}
// 入口の人数制限（「地図を開く」）：使用中＝最後の動きから ACTIVE_MS 以内のセッション。1日＝その日に入ったセッション
const ACTIVE_MS = 15 * 60_000;
const lastSeen = new Map(); // sid → 最後の動き
let admitDay = today(), admitted = new Set(), deniedToday = { users: 0, daily: 0 };
function seen(sid) { if (sid && sid !== "no-sid") { lastSeen.set(sid, Date.now()); if (lastSeen.size > 20000) pruneSeen(); } }
function pruneSeen() { const n = Date.now(); for (const [k, t] of lastSeen) if (n - t > ACTIVE_MS) lastSeen.delete(k); }
function rollAdmitDay() { if (today() !== admitDay) { admitDay = today(); admitted = new Set(); deniedToday = { users: 0, daily: 0 }; } }
function activeCount(except) { const n = Date.now(); let c = 0; for (const [k, t] of lastSeen) if (k !== except && n - t <= ACTIVE_MS) c++; return c; }
function admitStatus() { rollAdmitDay(); return { active: activeCount(), today: admitted.size, denied: deniedToday }; }
// 起動したとき：今日の記録から、入ったセッションと最後の動きを戻す（再起動で数え直しにならないように）
function loadAdmits() {
  try {
    for (const line of fs.readFileSync(path.join(DATA_DIR, `events-${today()}.jsonl`), "utf8").split("\n")) {
      if (!line) continue;
      try { const e = JSON.parse(line); const t = Date.parse(e.ts); if (e.sid && Date.now() - t <= ACTIVE_MS) lastSeen.set(e.sid, Math.max(lastSeen.get(e.sid) || 0, t)); if (e.type === "map" && e.sid) admitted.add(e.sid); } catch { /* 壊れた行 */ }
    }
  } catch { /* 今日の記録なし */ }
}
loadAdmits();
async function handleAdmit(req, res) {
  let b;
  try { b = await readBody(req, 2048); } catch { return send(res, 400, { error: "bad_request" }); }
  const sid = clip(b.sid, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return send(res, 400, { error: "bad_sid" });
  rollAdmitDay();
  const L = limits();
  if (!admitted.has(sid)) {
    if (activeCount(sid) >= L.maxUsers) { deniedToday.users++; touchSnap(); return send(res, 429, { error: "busy_users" }); }
    if (admitted.size >= L.dailySessions) { deniedToday.daily++; touchSnap(); return send(res, 429, { error: "daily_sessions" }); }
    admitted.add(sid);
  }
  seen(sid);
  return send(res, 200, { ok: true });
}

// 混んでいるときは断らずに順番を待たせる（最大 QUEUE_WAIT_MS）。空いたら来た順に通す
const waiters = [];
function acquire() {
  if (inflight < limits().maxInflight && !waiters.length) { inflight++; return Promise.resolve(true); }
  if (waiters.length >= QUEUE_MAX) return Promise.resolve(false);
  return new Promise((resolve) => {
    const w = { resolve, t: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(false); }, QUEUE_WAIT_MS) };
    waiters.push(w);
  });
}
function drainQueue() {
  while (waiters.length && inflight < limits().maxInflight) { const w = waiters.shift(); clearTimeout(w.t); inflight++; w.resolve(true); }
}
function release() { inflight--; drainQueue(); }

// ---- 入力の検査 ----
const clip = (s, n) => String(s ?? "").slice(0, n);
function parseBody(body) {
  const all = Array.isArray(body.messages) ? body.messages : [];
  const messages = all.slice(-20);
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: clip(m.content, 2000) }))
    .filter((m) => m.content.trim());
  if (!clean.length || clean[clean.length - 1].role !== "user") return null;
  const m = body.meta && typeof body.meta === "object" ? body.meta : {};
  const meta = {}; // 画面から添えられる「何を押したか」。分析用（信頼はしない）
  for (const k of ["q", "press", "typed", "branch", "branchBy", "place", "near", "road", "intent", "kind"]) {
    if (m[k] !== undefined) meta[k] = typeof m[k] === "number" || typeof m[k] === "boolean" ? m[k] : clip(m[k], 80);
  }
  const ctxLen = String(body.context ?? "").length;
  const cut = { // 切り捨て：試験用の表示で「あふれ」を見えるようにする
    context: ctxLen > 6000 ? { from: ctxLen, to: 6000 } : null,
    dropped: Math.max(0, all.length - 20),
    longMsgs: messages.filter((m) => m && typeof m.content === "string" && m.content.length > 2000).length,
  };
  return {
    meta, cut,
    type: body.type === "talk" ? "talk" : "ai", // 画面のタイプ（2 対話型／3 AI型）
    mode: body.mode === "staff" ? "staff" : "out", // 2 対話型の目線（out＝外野目線、staff＝社員目線）
    sid: clip(body.sid, 64) || "no-sid",
    by: clip(body.by, 32) || "visitor",
    context: clip(body.context, 6000), // 公開データの表（19行）＋書いた言葉＋指示。2000では末尾の指示が切れることがあった
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
    input = parseBody(await readBody(req, 262_144)); // 会話20往復＋公開データの表。32KBでは長い会話であふれることがある
  } catch (e) {
    return send(res, e.code === 413 ? 413 : 400, { error: "bad_request" });
  }
  if (!input) return send(res, 400, { error: "bad_request" });

  seen(input.sid);
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
  if (spentUsd >= limits().dailyCap) return reject(429, "daily_cap");
  if (rateLimited(who)) return reject(429, "rate_limited");

  const sp = input.type === "talk" ? (input.mode === "staff" ? SYSTEM_TALK_STAFF : SYSTEM_TALK) : SYSTEM_PROMPT;
  const system = input.context ? `${sp}\n\n【画面から渡された状況】\n${input.context}` : sp;
  const rec = { ...base, type: input.type, mode: input.type === "talk" ? input.mode : undefined, sid: input.sid, by: input.by, turn, context: input.context, userText, meta: input.meta };

  const waitFrom = Date.now();
  if (!(await acquire())) return reject(429, "busy");
  rec.queuedMs = Date.now() - waitFrom; // 順番待ちした長さ（混み具合の記録）
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
      trace: { system, messages: input.messages, cut: input.cut, maxTokens: MAX_TOKENS, queuedMs: rec.queuedMs }, // 試験用：送ったものをそのまま返す（原文は text）
      stopReason: r.stop_reason,
      usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
      costUsdEstimate: costUsd,
      ms: Date.now() - t0,
    });
  } catch (e) {
    writeLog({ ...rec, status: "error", httpStatus: e.status || 0, error: clip(e.message, 300), costUsd: 0, ms: Date.now() - t0 });
    return send(res, 502, { error: "upstream", httpStatus: e.status || 0, detail: clip(e.message, 300), trace: { system, messages: input.messages, cut: input.cut, maxTokens: MAX_TOKENS } });
  } finally {
    release();
  }
}

// ---- 管理画面の「読み取る」：URLのHPを読み（プログラム）、店の姿を根拠つきで作る（API 1回）。押したときだけ走る ----
async function handleShopRead(req, res) {
  const t0 = Date.now();
  const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
  let b;
  try { b = await readBody(req, 4096); } catch { return send(res, 400, { error: "bad_request" }); }
  const target = clip(b && b.url, 500);
  if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: "bad_url" });
  const base = { ts: new Date().toISOString(), who, model: MODEL, type: "shopread", url: target };
  if (disabled()) return send(res, 503, { error: "disabled" });
  if (!client) return send(res, 503, { error: "no_key" });
  if (today() !== spentDate) loadSpent();
  if (spentUsd >= limits().dailyCap) return send(res, 429, { error: "daily_cap" });
  if (rateLimited(who)) return send(res, 429, { error: "rate_limited" });
  const r = await readSite(target);
  const site = { final: r.final, title: r.title, js_only: !!r.js_only, picked: r.picked, error: r.error,
    pages: r.pages.map(p => ({ url: p.url, kind: p.kind, label: p.label, chars: (p.text || "").length, imgs: p.imgs, imgHeavy: p.imgHeavy, error: p.error })) };
  const heavy = r.pages.filter(p => p.imgHeavy).map(p => ({ top: "トップ", profile: "会社概要", case: "事例" }[p.kind] || p.kind));
  if (r.error || r.js_only) { // 読めないHPには API を使わない。読めないこと自体を店に見せる
    writeLog({ ...base, status: "unreadable", error: r.error || "js_only", costUsd: 0, ms: Date.now() - t0 });
    return send(res, 200, { site, shop: null, costUsdEstimate: 0, ms: Date.now() - t0 });
  }
  if (!(await acquire())) return send(res, 429, { error: "busy" });
  try {
    const u = await understand(client, { model: MODEL, maxTokens: 4000, effort: EFFORT }, r);
    const costUsd = estimateUsd(u.usage); spentUsd += costUsd;
    if (u.shop && heavy.length) u.shop.unread = [...(Array.isArray(u.shop.unread) ? u.shop.unread : []),
      `画像の中の文字（${heavy.join("・")}のページ。本文より画像が多く、売り文句が画像の中にあると、AIにも検索にも読まれていない可能性があります）`];
    writeLog({ ...base, status: u.shop ? "ok" : "bad_json", inputTokens: u.usage.input_tokens || 0, outputTokens: u.usage.output_tokens || 0, costUsd, ms: Date.now() - t0, reply: clip(u.text, 4000) });
    return send(res, 200, { site, shop: u.shop, raw: u.shop ? undefined : clip(u.text, 2000), costUsdEstimate: costUsd, ms: Date.now() - t0 });
  } catch (e) {
    writeLog({ ...base, status: "error", httpStatus: e.status || 0, error: clip(e.message, 300), costUsd: 0, ms: Date.now() - t0 });
    return send(res, 502, { error: "upstream", detail: clip(e.message, 300), site });
  } finally { release(); }
}

// ---- 画面の動き（開いた・地図・ピン・押したボタン・閉じた）。AI を呼ばない①〜③も含め、どこまで進んだかを残す ----
const EVENT_TYPES = new Set(["open", "map", "pin", "evaluate", "choice", "inquiry_open", "inquiry_send", "rewind", "view", "end"]);
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
  seen(clip(b.sid, 64));
  if (b.type === "map") { rollAdmitDay(); admitted.add(clip(b.sid, 64)); } // 古い画面（入口の確認を知らない窓）からの入りも、1日の数に入れる
  const data = {};
  if (b.data && typeof b.data === "object") for (const [k, v] of Object.entries(b.data).slice(0, 8)) data[clip(k, 20)] = typeof v === "number" || typeof v === "boolean" ? v : clip(v, 80);
  try {
    fs.appendFileSync(path.join(DATA_DIR, `events-${today()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), who, sid: clip(b.sid, 64) || "no-sid", by: clip(b.by, 32) || "visitor", type: b.type, ...(b.screen === "talk" ? { screen: "talk" } : {}), data }) + "\n", { mode: 0o600 });
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
  for (const [k, v] of Object.entries(s.sheet && typeof s.sheet === "object" ? s.sheet : {}).slice(0, 40)) sheet[clip(k, 24)] = v == null ? null : clip(v, 400);
  const p = s.pub && typeof s.pub === "object" ? s.pub : {};
  return {
    updated: num(s.updated), stage: clip(s.stage, 40), place: clip(s.place, 80), near: clip(s.near, 40), localKnowledge: clip(s.localKnowledge, 300), revised: clip(s.revised, 200),
    path: (Array.isArray(s.path) ? s.path : []).slice(0, 40).map((x) => ({ press: clip(x?.press, 80), q: num(x?.q) | 0, opt: num(x?.opt) | 0, type: clip(x?.type, 300), ...(x?.br === 0 || x?.br === 1 ? { br: x.br } : {}) })),
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
  if (!b.reconstructed) seen(sid);
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
  DATA_DIR, MODEL, PRICES, ADMIN_PASSWORD_FILE, readBody, disabled, limits, setLimits, admitStatus,
  getSpent: () => (today() === spentDate ? spentUsd : 0),
  // 読むとき：反映待ちの動き（1秒のまとめ待ち）があれば先に作り直す。リロードすれば、それまでの動きが必ず入った集計になる
  getSnapshot: () => { if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; rebuild(); } else if (!snap) rebuild(); return snap; },
  refresh: () => { changeSeq++; rebuild(); },
  getSeq: () => changeSeq,
  adminRate: () => { const n = Date.now(); while (adminHits.length && n - adminHits[0] > 60_000) adminHits.shift(); adminHits.push(n); return adminHits.length <= 120; },
};

rebuild(); // 起動時に1回
setInterval(() => { if (today() !== snapDay) rebuild(); }, 5 * 60_000); // 日が替わったときだけ、日付の集計を作り直す

// ---- 公開データ（不動産情報ライブラリ）：GET /api/land?lat=..&lng=.. ----
const land = landSetup({ keyFile: LAND_KEY_FILE, dataDir: DATA_DIR });
const landHits = new Map();
async function handleLand(req, res, url) {
  const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
  if (!(lat > 20 && lat < 46 && lng > 122 && lng < 154)) return send(res, 400, { error: "bad_position" }); // 日本の範囲だけ
  const who = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?");
  const n = Date.now(), h = (landHits.get(who) || []).filter(t => n - t < 60_000); h.push(n); landHits.set(who, h);
  if (h.length > 20) return send(res, 429, { error: "rate_limited" });
  try { return send(res, 200, await land.lookup(lat, lng)); }
  catch (e) { console.error("land:", e.message); return send(res, 502, { error: "land" }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, enabled: !disabled(), keyConfigured: !!client, model: MODEL });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "POST" && url.pathname === "/api/shopread") return await handleShopRead(req, res);
    if (req.method === "POST" && url.pathname === "/api/event") return await handleEvent(req, res);
    if (req.method === "POST" && url.pathname === "/api/session") return await handleSession(req, res);
    if (req.method === "POST" && url.pathname === "/api/admit") return await handleAdmit(req, res);
    if (req.method === "GET" && url.pathname === "/api/land") return await handleLand(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/mapkey") { let key = ""; try { key = fs.readFileSync(MAP_KEY_FILE, "utf8").trim(); } catch { /* なければ「道から見る」を出さない */ } return send(res, 200, { key }); }
    if (req.method === "GET" && url.pathname === "/api/public-stats") return send(res, 200, publicStats(adminCtx));
    if (await adminHandler(req, res, url, adminCtx)) return;
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("unhandled:", e.message);
    return send(res, 500, { error: "server" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`api listening :${PORT} model=${MODEL} key=${client ? "set" : "missing"} cap=$${limits().dailyCap}/day inflight=${limits().maxInflight} users=${limits().maxUsers} daily=${limits().dailySessions} land=${land.hasKey ? "api" : "sample"}`);
});
