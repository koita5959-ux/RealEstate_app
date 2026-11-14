// 利用状況の集計と、開発者向け管理画面（認証つき）。
// 記録の読み出し専用に近い。書き込むのは、単価・残高・為替の設定だけ（data/ の中）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const JST = (ts) => new Date(new Date(ts).getTime() + 9 * 3600_000).toISOString();
const dayOf = (ts) => JST(ts).slice(0, 10);
const IDLE_MS = 30 * 60_000; // 最後の動きから30分で「終了」とみなす

// ---- 記録の読み込み ----
function readJsonl(dir, prefix) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + "-") && f.endsWith(".jsonl")).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* 壊れた行は飛ばす */
      }
    }
  }
  return out;
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ---- 単価（いつから有効か付きの履歴）----
// 単価は USD/100万トークン。cacheRead は未設定なら入力の0.1倍、cacheWrite は1.25倍（仮説。実額と突き合わせて直す）。
function priceVersions(dir, defaults) {
  const saved = readJson(path.join(dir, "prices.json"), null);
  if (saved && Array.isArray(saved.versions) && saved.versions.length) return saved.versions.sort((a, b) => a.from.localeCompare(b.from));
  return [{ from: "2026-01-01T00:00:00Z", models: Object.entries(defaults).map(([model, p]) => ({ model, input: p.in, output: p.out })) }];
}
const versionAt = (ts, vs) => ([...vs].reverse().find((v) => v.from <= ts) || vs[0]);
const priceFor = (model, v) => {
  const hits = v.models.filter((m) => model && model.startsWith(m.model));
  return hits.sort((a, b) => b.model.length - a.model.length)[0] || null;
};
function estimate(row, vs) {
  const p = priceFor(row.model, versionAt(row.ts, vs));
  if (!p) return row.costUsd ?? null;
  const cr = p.cacheRead ?? p.input * 0.1, cw = p.cacheWrite ?? p.input * 1.25;
  return ((row.inputTokens || 0) * p.input + (row.outputTokens || 0) * p.output + (row.cacheRead || 0) * cr + (row.cacheCreate || 0) * cw) / 1e6;
}

// ---- 統計の小道具 ----
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
const pct = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// 書かれた言葉の仮の分類（キーワード）。画面にも規則を出す。
export const THEME_RULES = [
  ["費用・値段", /費用|値段|価格|いくら|料金|金額|相場|円|コスト/],
  ["相続・譲渡・税", /相続|税|贈与|譲渡|名義|遺産/],
  ["売る", /売却|売る|売り|買取|査定/],
  ["貸す・運用", /貸す|貸し|賃貸|駐車場|収入|利回り|運用|アパート|テナント/],
  ["建てる・建て替え", /建て|建築|新築|リフォーム|解体|セットバック|接道|再建築/],
  ["お隣・境界", /隣|境界|私道|通路|旗竿/],
  ["このサービス自体への質問", /導入|このアプリ|このサイト|御社|システム|AI|チャット|プラン|契約|機能|使い方/],
  ["テスト入力", /^(テスト|test|てすと|あ+|こんにちは|hello|hi|\.+|\?+|1+|a+)$/i],
];
const themeOf = (t) => (THEME_RULES.find(([, re]) => re.test(t.trim())) || ["その他"])[0];

// ---- 集計本体 ----
export function summarize(ctx) {
  const dir = ctx.DATA_DIR;
  const vs = priceVersions(dir, ctx.PRICES);
  const settings = { usdJpy: 150, ...readJson(path.join(dir, "settings.json"), {}) };
  const chat = readJsonl(dir, "log");
  const events = readJsonl(dir, "events");
  const balances = readJsonl(dir, "balances").sort((a, b) => a.ts.localeCompare(b.ts));

  // 各往復に推定額を付ける。残高の記録があれば、区間の実額を推定額の割合で割り振って「確定」にする。
  const turns = chat.map((r) => ({ ...r, est: estimate(r, vs) ?? 0, usd: null, fixed: false }));
  for (const t of turns) t.usd = t.est;
  for (let i = 1; i < balances.length; i++) {
    const [a, b] = [balances[i - 1], balances[i]];
    const inside = turns.filter((t) => t.ts > a.ts && t.ts <= b.ts);
    const est = sum(inside, (t) => t.est), spent = a.amount_usd - b.amount_usd;
    for (const t of inside) {
      t.usd = est > 0 ? (spent * t.est) / est : t.est;
      t.fixed = est > 0;
    }
  }
  // Console の「日ごとの金額」（ロット）：入れた日は、その日の往復へ推定の割合で割り振って「確定」にする（残高の割り振りより優先）。
  // Console の日の区切りは、設定で UTC（日本時間 9:00 切り替え）か日本時間かを選ぶ。
  const cons = readJson(path.join(dir, "console-days.json"), {});
  const lotTz = cons.tz === "JST" ? "JST" : "UTC";
  const lotDay = (ts) => (lotTz === "UTC" ? new Date(ts).toISOString().slice(0, 10) : dayOf(ts));
  const lotIn = cons.days && typeof cons.days === "object" ? cons.days : {};
  for (const [day, L] of Object.entries(lotIn)) {
    if (!(L && L.usd >= 0)) continue;
    const inside = turns.filter((t) => lotDay(t.ts) === day);
    const est = sum(inside, (t) => t.est);
    for (const t of inside) { t.usd = est > 0 ? (L.usd * t.est) / est : t.est; t.fixed = est > 0; }
  }
  const okTurns = turns.filter((t) => t.status === "ok");
  const lotMap = new Map();
  for (const t of okTurns) {
    const d = lotDay(t.ts);
    const x = lotMap.get(d) || { day: d, rounds: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheCreate: 0, est: 0 };
    x.rounds++; x.inTok += t.inputTokens || 0; x.outTok += t.outputTokens || 0; x.cacheRead += t.cacheRead || 0; x.cacheCreate += t.cacheCreate || 0; x.est += t.est;
    lotMap.set(d, x);
  }
  for (const d of Object.keys(lotIn)) if (!lotMap.has(d)) lotMap.set(d, { day: d, rounds: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheCreate: 0, est: 0 });
  const lots = { tz: lotTz, days: [...lotMap.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 45).map((x) => {
    const L = lotIn[x.day] || null;
    return { ...x, console: L, diff: L ? L.usd - x.est : null, ratio: L && x.est > 0 ? L.usd / x.est : null };
  }) };

  // 残高の区間ごとの観察（実額と推定のずれ）
  const segments = [];
  for (let i = 1; i < balances.length; i++) {
    const [a, b] = [balances[i - 1], balances[i]];
    const inside = turns.filter((t) => t.ts > a.ts && t.ts <= b.ts);
    const est = sum(inside, (t) => t.est), spent = a.amount_usd - b.amount_usd;
    segments.push({ from: a.ts, to: b.ts, spent, est, diff: spent - est, ratio: est > 0 ? spent / est : null, rounds: inside.filter((t) => t.status === "ok").length, note: b.note || "" });
  }
  const lastBal = balances[balances.length - 1] || null;
  const sinceLast = lastBal ? turns.filter((t) => t.ts > lastBal.ts) : [];
  const balanceNow = lastBal ? lastBal.amount_usd - sum(sinceLast, (t) => t.est) : null;

  // セッション（画面を開いてから閉じるまで）
  const sess = new Map();
  const S = (sid) => {
    if (!sess.has(sid)) sess.set(sid, { sid, by: "?", started: null, last: null, screen: "ai", rounds: 0, errors: 0, rejected: 0, inTok: 0, outTok: 0, est: 0, usd: 0, fixed: true, maxQ: 0, place: "", branch: "", ended: false, events: 0, first: "", reach: -1, inqOpen: false, inqSend: false });
    return sess.get(sid);
  };
  const touch = (s, ts) => { if (!s.started || ts < s.started) s.started = ts; if (!s.last || ts > s.last) s.last = ts; };
  for (const t of turns) {
    if (t.type === "shopread") { // 管理画面の「読み取る」：1回ずつ別の行。URLを「最初の言葉」の欄に出す（前は sid なしで「?」の1行にまとまっていた）
      const s = S(t.sid || "read-" + t.ts); touch(s, t.ts); s.by = t.by || "（記録なし）"; s.screen = "read";
      s.first = "読み取り：" + (t.url || "") + (t.status === "cached" ? "（同じ日の結果を使用・費用0）" : t.status === "unreadable" ? "（読めないHP・費用0）" : "");
      if (t.status === "ok") { s.rounds++; s.inTok += t.inputTokens || 0; s.outTok += t.outputTokens || 0; s.est += t.est; s.usd += t.usd; s.fixed = s.fixed && t.fixed; }
      continue;
    }
    const s = S(t.sid || "no-sid"); touch(s, t.ts); s.by = t.by || s.by; if (t.type === "talk") s.screen = "talk"; // 画面のタイプ（2 対話型／3 AI型）
    if (t.status === "ok") { s.rounds++; s.inTok += t.inputTokens || 0; s.outTok += t.outputTokens || 0; s.est += t.est; s.usd += t.usd; s.fixed = s.fixed && t.fixed; if (!s.first && t.userText) s.first = t.userText; }
    else if (t.status === "rejected") s.rejected++; else s.errors++;
    if (t.meta) { s.maxQ = Math.max(s.maxQ, +t.meta.q || 0); if (t.meta.place) s.place = t.meta.place; if (t.meta.branch) s.branch = t.meta.branch; }
  }
  for (const e of events) {
    const s = S(e.sid || "no-sid"); touch(s, e.ts); s.events++; if (s.by === "?") s.by = e.by || "?"; if (e.screen === "talk") s.screen = "talk";
    if (e.type === "end") s.ended = true;
    const R = { open: 0, map: 1, pin: 2, evaluate: 3, choice: 3 }; // どこまで進んだか（①以降は maxQ で見る）
    if (e.type in R) s.reach = Math.max(s.reach, R[e.type]);
    if (e.type === "inquiry_open") s.inqOpen = true;
    if (e.type === "inquiry_send") s.inqSend = true;
    if (e.type === "map" && e.data?.place) s.place = e.data.place;
    if (e.type === "choice") s.maxQ = Math.max(s.maxQ, +e.data?.q || 0);
  }
  let saved = new Set();
  try { saved = new Set(fs.readdirSync(path.join(dir, "sessions")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))); } catch { /* まだ無い */ }
  const now = Date.now();
  const sessions = [...sess.values()].map((s) => ({ ...s, hasState: saved.has(s.sid), canReplay: s.screen !== "read" && (s.rounds > 0 || s.maxQ > 0 || (saved.has(s.sid) && s.reach >= 3)), active: !s.ended && s.last && now - new Date(s.last).getTime() < IDLE_MS })).sort((a, b) => (b.last || "").localeCompare(a.last || ""));

  // 日別（日本時間）
  const dayMap = new Map();
  for (const t of okTurns) {
    const d = dayOf(t.ts), k = d + "|" + (t.by || "?");
    const x = dayMap.get(k) || { day: d, by: t.by || "?", rounds: 0, sessions: new Set(), inTok: 0, outTok: 0, est: 0, usd: 0, fixed: true };
    x.rounds++; x.sessions.add(t.sid); x.inTok += t.inputTokens || 0; x.outTok += t.outputTokens || 0; x.est += t.est; x.usd += t.usd; x.fixed = x.fixed && t.fixed;
    dayMap.set(k, x);
  }
  const days = [...dayMap.values()].map((x) => ({ ...x, sessions: x.sessions.size })).sort((a, b) => b.day.localeCompare(a.day) || a.by.localeCompare(b.by));

  // 誰の利用か
  const actors = {};
  for (const s of sessions) {
    const a = (actors[s.by] ||= { by: s.by, sessions: 0, withAi: 0, rounds: 0, usd: 0, est: 0 });
    a.sessions++; if (s.rounds) a.withAi++; a.rounds += s.rounds; a.usd += s.usd; a.est += s.est;
  }

  // 今日・今月・通算
  const today = dayOf(new Date().toISOString()), month = today.slice(0, 7);
  const sumOf = (arr) => ({ rounds: arr.length, est: sum(arr, (t) => t.est), usd: sum(arr, (t) => t.usd) });
  const totals = { today: sumOf(okTurns.filter((t) => dayOf(t.ts) === today)), month: sumOf(okTurns.filter((t) => dayOf(t.ts).startsWith(month))), all: sumOf(okTurns) };
  const rej = turns.filter((t) => t.status === "rejected" && dayOf(t.ts) === today);
  const rejected = {}; for (const t of rej) rejected[t.reason || "?"] = (rejected[t.reason || "?"] || 0) + 1;
  const errorsToday = turns.filter((t) => t.status === "error" && dayOf(t.ts) === today).length;

  // 費用の目安（販売用）。「相談1件」＝AIとやり取りしたセッション。テスト（visitor 以外）も別に出せるよう by 別に持つ。
  const perSession = (filter) => {
    const ss = sessions.filter((s) => s.rounds > 0 && filter(s));
    const costs = ss.map((s) => s.est), rounds = ss.map((s) => s.rounds);
    return { n: ss.length, avgUsd: ss.length ? sum(costs) / ss.length : null, p50: pct(costs, 0.5), p90: pct(costs, 0.9), maxUsd: costs.length ? Math.max(...costs) : null,
      avgRounds: ss.length ? sum(rounds) / ss.length : null, avgIn: ss.length ? sum(ss, (s) => s.inTok) / ss.length : null, avgOut: ss.length ? sum(ss, (s) => s.outTok) / ss.length : null };
  };
  const explain = { visitor: perSession((s) => s.by === "visitor"), all: perSession(() => true), usdJpy: settings.usdJpy, model: ctx.MODEL };
  // 同じトークン量を、ほかのモデルの単価で見積もり直す（品質は同じとは限らない）
  const vNow = vs[vs.length - 1], base = explain.visitor.n ? explain.visitor : explain.all;
  explain.models = base.n ? vNow.models.map((m) => ({ model: m.model, perSessionUsd: ((base.avgIn || 0) * m.input + (base.avgOut || 0) * m.output) / 1e6 })) : [];

  // 何を試しているか
  // 「その段階以上に進んだセッション」を数える（記録が欠けても、後ろの段階に進んだ人は前も通ったとみなす）。
  // 地図・問い合わせは、通らなくても先へ進める横道なので、実際に押した数をそのまま数える。
  const chain = ["open", "pin", "evaluate", "q1", "q2", "q3", "q4", "q5"];
  const stagesOrder = ["open", "map", "pin", "evaluate", "q1", "q2", "q3", "q4", "q5", "inquiry_open", "inquiry_send"];
  const funnelFor = (by) => {
    const reach = new Map(), side = { map: new Set(), inquiry_open: new Set(), inquiry_send: new Set() };
    const up = (sid, i) => reach.set(sid, Math.max(reach.get(sid) ?? -1, i));
    for (const e of events) {
      if (by && e.by !== by) continue;
      if (e.type in side) side[e.type].add(e.sid);
      const i = e.type === "choice" ? (+e.data?.q >= 1 ? 2 + Math.min(+e.data.q, 5) : 0) : chain.indexOf(e.type);
      up(e.sid, i >= 0 ? i : 0);
    }
    for (const t of turns) { if (by && t.by !== by) continue; if (t.status === "ok") up(t.sid, (t.turn || 1) >= 2 ? 7 : 6); }
    return stagesOrder.map((k) => {
      const i = chain.indexOf(k);
      return { stage: k, sessions: i >= 0 ? [...reach.values()].filter((r) => r >= i).length : side[k].size };
    });
  };
  const bys = [...new Set([...sessions.map((s) => s.by)])];
  const funnel = { _all: funnelFor(null), ...Object.fromEntries(bys.map((b) => [b, funnelFor(b)])) };

  const tally = (arr, keyf) => { const m = new Map(); for (const x of arr) { const k = keyf(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n); };
  const chatMeta = turns.filter((t) => t.meta && t.status === "ok");
  const purposes = tally(chatMeta.filter((t) => +t.meta.q === 4), (t) => t.meta.press || "（書いた言葉のみ）");
  const later = tally(chatMeta.filter((t) => +t.meta.q > 4), (t) => `④以降：${t.meta.press || "（書いた言葉のみ）"}`);
  const branches = tally(chatMeta.filter((t) => +t.meta.q === 4), (t) => t.meta.branch);
  const roads = tally(events.filter((e) => e.type === "choice" && +e.data?.q <= 3), (e) => `${["①", "①", "②"][e.data.q - 1]} ${e.data.press}`);
  const places = tally(events.filter((e) => e.type === "evaluate"), (e) => e.data?.place); // 評価まで進んだ地域
  const near = tally(events.filter((e) => e.type === "evaluate"), (e) => e.data?.near);
  const texts = chatMeta.filter((t) => /書いた言葉：/.test(t.userText || "")).map((t) => ({ ts: t.ts, by: t.by, q: +t.meta.q || 0, text: (t.userText.split("書いた言葉：")[1] || "").trim(), theme: "" }));
  for (const x of texts) x.theme = themeOf(x.text);
  const themes = tally(texts, (x) => x.theme);
  const devices = tally(events.filter((e) => e.type === "open"), (e) => (e.data?.mobile ? "スマホ幅" : "PC幅"));
  const refs = tally(events.filter((e) => e.type === "open"), (e) => e.data?.ref || "（直接・不明）");

  return {
    computedAt: new Date().toISOString(), now: new Date().toISOString(), config: { model: ctx.MODEL, dailyCap: ctx.limits().dailyCap, maxInflight: ctx.limits().maxInflight, maxUsers: ctx.limits().maxUsers, dailySessions: ctx.limits().dailySessions, admit: ctx.admitStatus(), limitsHistory: ctx.limits().history.slice(0, 10), spentToday: ctx.getSpent(), disabled: ctx.disabled(), usdJpy: settings.usdJpy },
    totals, rejected, errorsToday, balances, balanceNow, segments, lots, sessions: sessions.slice(0, 300), days: days.slice(0, 120), actors: Object.values(actors),
    explain, prices: vs, themeRules: THEME_RULES.map(([n, re]) => ({ name: n, rule: re.source })),
    tested: { funnel, purposes, later, branches, roads, places, near, texts: texts.slice(-150).reverse(), themes, devices, refs },
    turns: turns.slice(-200).reverse().map((t) => ({ ts: t.ts, sid: t.sid, by: t.by, status: t.status, reason: t.reason, turn: t.turn, q: t.meta?.q, press: t.meta?.press, typed: t.meta?.typed, branchBy: t.meta?.branchBy, inTok: t.inputTokens, outTok: t.outputTokens, est: t.est, usd: t.usd, fixed: t.fixed, ms: t.ms, user: t.userText, reply: t.reply, trig: t.triggers })),
  };
}

// 利用者に見せてよい平均値だけ（個々の記録・本文は出さない）。データが少ないうちは null。
export function publicStats(ctx) {
  const s = ctx.getSnapshot().explain;
  const e = s.visitor.n >= 5 ? s.visitor : null; // 公開用は、一般の訪問者（visitor）の分だけ。5件に満たなければ出さない（開発のテスト分は混ぜない）
  if (!e) return { ready: false };
  return { ready: true, sessions: e.n, avgUsd: e.avgUsd, p90Usd: e.p90, avgRounds: e.avgRounds, usdJpy: s.usdJpy, model: s.model };
}

// ---- セッションの再表示の部品 ----
function turnsOf(dir, sid) {
  return readJsonl(dir, "log").filter((r) => r.sid === sid).map((r) => ({ ts: r.ts, status: r.status, reason: r.reason, q: r.meta?.q, press: r.meta?.press, user: r.userText, reply: r.reply, inTok: r.inputTokens, outTok: r.outputTokens, costUsd: r.costUsd, ms: r.ms }));
}
// 保存した記録がない（この機能を入れる前の）セッションを、ログと画面の動きの記録から復元する。復元できない項目（面積・地価など）は空になる。
function reconstruct(ctx, sid) {
  const byTs = (a, b) => a.ts.localeCompare(b.ts);
  const logs = readJsonl(ctx.DATA_DIR, "log").filter((r) => r.sid === sid).sort(byTs);
  const evs = readJsonl(ctx.DATA_DIR, "events").filter((e) => e.sid === sid).sort(byTs);
  if (!logs.length && !evs.some((e) => e.type === "choice" || e.type === "evaluate")) return null;
  const ok = logs.filter((r) => r.status === "ok");
  const textOf = (r) => ((r.userText || "").split("書いた言葉：")[1] || "").trim();
  const path_ = evs.filter((e) => e.type === "choice").map((e) => {
    const q = +e.data?.q || 0;
    const t = e.data?.typed ? logs.find((r) => +r.meta?.q === q && textOf(r)) : null;
    return { press: String(e.data?.press || ""), q, opt: +e.data?.opt || 0, type: t ? textOf(t) : "" };
  });
  const m = ok.find((r) => r.meta)?.meta || {};
  const evalEv = evs.find((e) => e.type === "evaluate");
  const q4 = ok.find((r) => +r.meta?.q === 4);
  const sheet = {
    市区町村: m.place || evalEv?.data?.place || null,
    最寄り標準地: m.near || evalEv?.data?.near || null,
    接道: m.road || null,
    持ち主の意向: m.intent || null,
    事情: ok.map(textOf).filter(Boolean).join(" / ") || null,
    相談目的: q4 ? q4.meta?.press || null : null,
  };
  const ps = ctx.getSnapshot().explain, e = ps.visitor.n >= 5 ? ps.visitor : ps.all.n >= 5 ? ps.all : null;
  const last = [...logs, ...evs].sort(byTs).pop();
  const pinEv = evs.find((e) => e.type === "pin" && Number.isFinite(+e.data?.lat));
  return {
    pin: pinEv ? { lat: +pinEv.data.lat, lng: +pinEv.data.lng } : null,
    by: (logs[0] || evs[0]).by || "?", savedAt: last.ts,
    state: {
      updated: new Date(last.ts).getTime(), place: sheet.市区町村 || "", near: sheet.最寄り標準地 || "", localKnowledge: "（ログからの復元のため、記録なし）", revised: "",
      path: path_, sheet, signals: [],
      usage: { n: ok.length, tin: sum(ok, (r) => r.inputTokens), tout: sum(ok, (r) => r.outputTokens), costUsd: sum(ok, (r) => r.costUsd) },
      pub: e ? { ready: true, avgUsd: e.avgUsd, p90Usd: e.p90, sessions: e.n, usdJpy: ps.usdJpy } : { ready: false, usdJpy: ps.usdJpy },
    },
  };
}

// ---- 認証（Basic）----
function passwordOk(req, ctx) {
  let want = "";
  try { want = fs.readFileSync(ctx.ADMIN_PASSWORD_FILE, "utf8").trim(); } catch { return false; }
  if (!want) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const given = Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- 総当たり対策：パスワードが短くても破られにくいよう、間違いを重ねたら一定時間ロックする ----
// 同じ人（IPのハッシュ）が5回間違えると15分ロック。全体でも1時間に100回間違えられたら、1時間ロック。
const fails = new Map();
let globalFails = [], globalLockUntil = 0;
function lockLeft(who) {
  const now = Date.now();
  if (now < globalLockUntil) return globalLockUntil - now;
  const f = fails.get(who);
  return f && now < f.lockUntil ? f.lockUntil - now : 0;
}
function recordFail(who) {
  const now = Date.now();
  const f = fails.get(who) || { n: 0, lockUntil: 0, last: 0 };
  if (now - f.last > 15 * 60_000) f.n = 0;
  f.n++; f.last = now;
  if (f.n >= 5) { f.lockUntil = now + 15 * 60_000; f.n = 0; }
  fails.set(who, f); if (fails.size > 5000) fails.clear();
  globalFails = globalFails.filter((t) => now - t < 3600_000); globalFails.push(now);
  if (globalFails.length >= 100) { globalLockUntil = now + 3600_000; globalFails = []; }
}

// 管理系の入口。処理したら true。
export async function adminHandler(req, res, url, ctx) {
  if (!url.pathname.startsWith("/api/admin")) return false;
  const deny = () => { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="RealEstate_app admin", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" }); res.end("認証が必要です"); return true; };
  if (!ctx.adminRate()) { res.writeHead(429); res.end(); return true; }
  const who = crypto.createHash("sha256").update(String(req.headers["x-real-ip"] || req.socket.remoteAddress || "")).digest("hex").slice(0, 12);
  const wait = lockLeft(who);
  if (wait > 0) { res.writeHead(429, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.ceil(wait / 1000)) }); res.end("間違いが続いたため、しばらくロックしています。時間をおいてください。"); return true; }
  if (!passwordOk(req, ctx)) {
    if ((req.headers.authorization || "").startsWith("Basic ")) recordFail(who); // 入力が無い最初の表示は、間違いに数えない
    return deny();
  }
  fails.delete(who);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); return true; };

  if (req.method === "GET" && (url.pathname === "/api/admin" || url.pathname === "/api/admin/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    res.end(fs.readFileSync(new URL("./admin.html", import.meta.url)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/summary") { // 保存した集計を返すだけ。設定の読み取り値（停止スイッチ・今日の費用）だけは今の値に差し替える
    const snap = ctx.getSnapshot();
    const shared = readJson(path.join(ctx.DATA_DIR, "shared.json"), {}); // GitHub へ渡したセッション（tools/sync-owner.mjs が書く）
    let queued = []; try { queued = fs.readdirSync(path.join(ctx.DATA_DIR, "share-queue")); } catch { /* なし */ }
    return json(200, { ...snap, shared, queued, config: { ...snap.config, spentToday: ctx.getSpent(), disabled: ctx.disabled() } });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/stamp") { // 開発利用状況が数秒ごとに聞く「新しい動きがあったか」（数字が変わったら読み直す）。集計はしない
    return json(200, { seq: ctx.getSeq() });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/export") { // 1セッションを UTF-8 のテキストで書き出す（Claude.ai に読ませる用）：条件1行＋会話＋AIへ渡したもの
    const sid = url.searchParams.get("sid") || "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return json(400, { error: "bad_sid" });
    const logs = readJsonl(ctx.DATA_DIR, "log").filter((r) => r.sid === sid && r.type !== "shopread").sort((a, b) => a.ts.localeCompare(b.ts));
    if (!logs.length) return json(404, { error: "not_found" });
    const first = logs[0], last = logs[logs.length - 1], c0 = String(first.context || "");
    const pick = (re) => (c0.match(re) || [])[1] || "";
    const company = pick(/【あなたを置いた会社：([^（】]+)/) || pick(/【弊社のこと（あなたは(.+?)の社員/) || (pick(/・どんな会社か：([^\n]{0,40})/) ? "（HPの読み）" + pick(/・どんな会社か：([^\n]{0,40})/) : "");
    const head = [
      "タイプ：" + (first.type === "talk" ? "2 対話型" + (first.mode ? "（" + (first.mode === "staff" ? "社員目線" : "外野目線") + "）" : "") : "3 AI型"),
      company && "会社：" + company,
      pick(/弊社の業態：([^\n]+)/) && "業態：" + pick(/弊社の業態：([^\n]+)/),
      "場所：" + (first.meta?.place || "—"),
      "日時：" + new Date(first.ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
      "往復：" + logs.filter((r) => r.status === "ok").length,
      "利用者名：" + (first.by || "—"), "セッション：" + sid,
    ].filter(Boolean).join("／");
    const num = "①①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"; // 記録の q で引く。表示は何往復目か（q−1）
    const body = logs.map((r) => `── ${r.meta?.q ? num[r.meta.q - 1] || r.meta.q : ""} ${new Date(r.ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })}${r.status === "ok" ? "" : "（" + r.status + (r.reason ? "：" + r.reason : "") + "）"}\n利用者：${r.userText || ""}\nAI：${r.reply || "（返事なし）"}`).join("\n\n");
    const ctxs = [["最初の返事", first], ...(last !== first ? [["最後の返事", last]] : [])];
    const tail = ctxs.map(([k, r]) => `── AIへ渡した説明（${k}・${r.meta?.q ? num[r.meta.q - 1] || "" : ""}）\n${r.contextFixed ? "【店のこと】\n" + r.contextFixed + "\n\n" : ""}${r.context || "（記録なし）"}${r.memo ? "\n\n【AIが書いたメモ】\n" + JSON.stringify(r.memo) : ""}`).join("\n\n");
    const text = `${head}\n\n＝＝ 会話 ＝＝\n${body}\n\n＝＝ AIへ渡したもの（土地の条件・HPの読み・指示） ＝＝\n${tail}\n`;
    const name = `session_${new Date(first.ts).toISOString().slice(0, 10)}_${first.type === "talk" ? "Type2" : "Type3"}_${sid.slice(0, 8)}.txt`;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${name}"` });
    res.end("﻿" + text); return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/share") { // 利用状況の「GitHubへ渡す」：このセッションを渡す順番待ちに入れる。サーバー機の tools/sync-owner.mjs が1分ごとに上げる（コンテナは GitHub の鍵を持たない）
    const sid = url.searchParams.get("sid") || "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return json(400, { error: "bad_sid" });
    const q = path.join(ctx.DATA_DIR, "share-queue");
    fs.mkdirSync(q, { recursive: true });
    fs.writeFileSync(path.join(q, sid), new Date().toISOString());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GitHubへ渡す</title><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.8"><b>受け付けました。</b><br>このセッション（${sid.slice(0, 8)}）の記録を、1〜2分のうちに GitHub の _works/ へ上げます。<br>このタブは閉じてかまいません。</body>`);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/session") { // セッションの再表示用（記録＋会話の本文）。保存した記録がなければ、ログから復元する
    const sid = url.searchParams.get("sid") || "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return json(400, { error: "bad_sid" });
    const turns = turnsOf(ctx.DATA_DIR, sid);
    const rec = readJson(path.join(ctx.DATA_DIR, "sessions", sid + ".json"), null);
    if (rec) return json(200, { sid, by: rec.by, savedAt: rec.savedAt, state: rec.state, snapshot: rec.snapshot || null, turns, reconstructed: !!rec.reconstructed });
    const re = reconstruct(ctx, sid);
    if (!re) return json(404, { error: "not_found" });
    return json(200, { sid, by: re.by, savedAt: re.savedAt, state: re.state, turns, reconstructed: true, pin: re.pin });
  }

  if (req.method === "POST") {
    let body;
    try { body = await ctx.readBody(req); } catch { return json(400, { error: "bad_request" }); }
    if (url.pathname === "/api/admin/balance") { // 残高の記録（Console の「残高」を見て入れる）
      const amount = Number(body.amount_usd);
      if (!Number.isFinite(amount) || amount < 0) return json(400, { error: "bad_amount" });
      const rec = { ts: new Date().toISOString(), amount_usd: amount, note: String(body.note || "").slice(0, 100) };
      fs.appendFileSync(path.join(ctx.DATA_DIR, `balances-${rec.ts.slice(0, 4)}.jsonl`), JSON.stringify(rec) + "\n", { mode: 0o600 });
      ctx.refresh(); // 設定を変えたので、すぐ集計を作り直す
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/admin/consoleday") { // Console の日ごとの金額（ロット）。金額を空で送ると、その日の記録を消す
      const day = String(body.day || "");
      if (!/^\d{4}-\d\d-\d\d$/.test(day)) return json(400, { error: "bad_day" });
      const f = path.join(ctx.DATA_DIR, "console-days.json"), c = readJson(f, {});
      c.days = c.days && typeof c.days === "object" ? c.days : {};
      if (body.usd === "" || body.usd == null) delete c.days[day];
      else {
        const usd = Number(body.usd), opt = (v) => (v === "" || v == null ? null : Number(v));
        const inTok = opt(body.inTok), outTok = opt(body.outTok);
        if (!Number.isFinite(usd) || usd < 0 || [inTok, outTok].some((v) => v != null && !(Number.isFinite(v) && v >= 0))) return json(400, { error: "bad_amount" });
        c.days[day] = { usd, inTok, outTok, note: String(body.note || "").slice(0, 100), ts: new Date().toISOString() };
      }
      fs.writeFileSync(f, JSON.stringify(c, null, 1), { mode: 0o600 });
      ctx.refresh();
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/admin/consoletz") {
      const tz = body.tz === "JST" ? "JST" : "UTC";
      const f = path.join(ctx.DATA_DIR, "console-days.json"), c = readJson(f, {});
      fs.writeFileSync(f, JSON.stringify({ ...c, tz }, null, 1), { mode: 0o600 });
      ctx.refresh();
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/admin/limits") { // 公開テストの歯止め：1日の費用上限・同時に処理するAIの数（打ち間違いに備えて上限の上限を決める）
      const dailyCap = Math.round(Number(body.dailyCap) * 100) / 100, maxInflight = Math.round(Number(body.maxInflight));
      const maxUsers = Math.round(Number(body.maxUsers)), dailySessions = Math.round(Number(body.dailySessions));
      if (!(dailyCap >= 0.1 && dailyCap <= 20)) return json(400, { error: "bad_cap" });
      if (!(maxInflight >= 1 && maxInflight <= 20)) return json(400, { error: "bad_inflight" });
      if (!(maxUsers >= 1 && maxUsers <= 100)) return json(400, { error: "bad_users" });
      if (!(dailySessions >= 1 && dailySessions <= 1000)) return json(400, { error: "bad_daily" });
      ctx.setLimits({ dailyCap, maxInflight, maxUsers, dailySessions });
      ctx.refresh();
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/admin/settings") {
      const usdJpy = Number(body.usdJpy);
      if (!(usdJpy > 50 && usdJpy < 500)) return json(400, { error: "bad_rate" });
      fs.writeFileSync(path.join(ctx.DATA_DIR, "settings.json"), JSON.stringify({ ...readJson(path.join(ctx.DATA_DIR, "settings.json"), {}), usdJpy }), { mode: 0o600 });
      ctx.refresh();
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/admin/prices") { // 保存すると「今から有効な新しい版」になる。過去の往復は当時の単価のまま。
      const models = (Array.isArray(body.models) ? body.models : []).map((m) => ({ model: String(m.model || "").slice(0, 60), input: Number(m.input), output: Number(m.output), ...(m.cacheRead > 0 ? { cacheRead: Number(m.cacheRead) } : {}) })).filter((m) => m.model && m.input >= 0 && m.output >= 0);
      if (!models.length) return json(400, { error: "no_models" });
      const vs = priceVersions(ctx.DATA_DIR, ctx.PRICES);
      vs.push({ from: new Date().toISOString(), models });
      fs.writeFileSync(path.join(ctx.DATA_DIR, "prices.json"), JSON.stringify({ versions: vs }, null, 1), { mode: 0o600 });
      ctx.refresh();
      return json(200, { ok: true });
    }
  }
  return json(404, { error: "not_found" });
}
