// 売買の物件ページから「どの地区に、どういう物件があるか」の組を作る（AIなし）。2026-11-15
// 物件は撒き餌で在庫とは限らないが、店の扱いの表れとして使う。個別の物件・実在の町名は出さず、
// 学区（なければ駅、なければ郵便番号の旧5桁で丸めた町）にぼかす。
import fs from "fs";
import path from "path";
import { get, parse } from "./read.js";

const MUNI = (() => { for (const u of ["../muni.json", "../../docs/data/muni.json"]) try { return JSON.parse(fs.readFileSync(new URL(u, import.meta.url))); } catch {} return null; })();
const BUY = /物件|売買|売物件|売り物件|土地|売地|戸建|一戸建|中古|新築|分譲|マンション|bukken|property|estate|sale|baibai|tochi|kodate|search|list/i;
const RENT = /賃貸|貸家|貸地|貸店舗|rent|chintai|月極|駐車場/i;
const GUESS = ["bukken/", "property/", "estate/", "sale/", "baibai/", "tochi/", "search/", "list/", "buy/"];
// 物件の種類（目立つ言葉 → 呼び名）。前の方が優先
const TYPES = [[/古家/, "古家付きの土地"], [/農地|現況田|現況畑|地目：?田|地目：?畑/, "農地"], [/山林/, "山林"], [/分譲地/, "分譲地"],
  [/事業用|店舗|倉庫|工場|収益|アパート一棟/, "事業用・収益"], [/新築戸建|新築一戸建|建売/, "新築戸建て"], [/中古戸建|中古一戸建|中古住宅/, "中古戸建て"],
  [/マンション/, "マンション"], [/売地|土地|更地/, "土地"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let CITIES = null;
function cities() {
  if (CITIES) return CITIES;
  CITIES = [];
  if (MUNI) for (const [pref, list] of Object.entries(MUNI.munis || MUNI.cities || {})) for (const c of list) CITIES.push({ pref, c: String(typeof c === "string" ? c : c.name).replace(/\s/g, "") });
  return CITIES;
}

// 本文から「市区町村＋町名」を拾う。前後の文字も返す（種類を見分けるため）
function towns(text) {
  const out = [];
  for (const { pref, c } of cities()) {
    let i = text.indexOf(c);
    while (i >= 0 && out.length < 400) {
      const m = text.slice(i + c.length, i + c.length + 14).match(/^([^\s\d０-９,，、。()（）\[\]【】/／|:：・-]{1,10}?)(?=[\d０-９一二三四五六七八九十]|丁目|番|字|大字|\s|$|[、。,（(])/);
      if (m && !/^(内|周辺|全域|エリア|の|市|区|町$|村$)/.test(m[1])) out.push({ pref, city: c, at: i, end: i + c.length, town: m[1].replace(/大字|字/g, ""), near: text.slice(Math.max(0, i - 60), i + 80) });
      i = text.indexOf(c, i + c.length);
    }
  }
  // 長い名前（岡山市北区）に含まれる短い名前（北区）を外し、一番多い都道府県だけ残す
  const keep = out.filter((a) => !out.some((b) => b !== a && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at));
  const votes = {}; for (const a of keep) votes[a.pref] = (votes[a.pref] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  return keep.filter((a) => a.pref === top);
}
const typeOf = (s) => (TYPES.find(([re]) => re.test(s)) || [null, null])[1];

// 郵便番号（data/postal/utf_ken_all.csv）：市区町村 → [{町, 旧5桁}]
let POSTAL = null;
function postal(dataDir) {
  if (POSTAL) return POSTAL;
  POSTAL = new Map();
  try {
    const csv = fs.readFileSync(path.join(dataDir, "postal", "utf_ken_all.csv"), "utf8");
    for (const line of csv.split(/\r?\n/)) {
      const f = line.split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (f.length < 9) continue;
      const town = f[8].replace(/（.*$|\(.*$/, "").trim();
      if (!town || /以下に掲載がない場合|の次に番地がくる場合/.test(town)) continue;
      const city = f[7].replace(/^.+?郡(?=.+[町村]$)/, "");
      if (!POSTAL.has(city)) POSTAL.set(city, []);
      POSTAL.get(city).push({ town, z5: f[1].trim() });
    }
  } catch { /* なければ郵便番号の丸めをしない */ }
  return POSTAL;
}
function zoneOf(dataDir, city, town) {
  let best = null;
  for (const e of postal(dataDir).get(city) || []) if (town.startsWith(e.town) && (!best || e.town.length > best.town.length)) best = e;
  return best ? best.z5 : null;
}

// 町ごとの呼び名：学区 → 駅（800m以内＝徒歩圏、2kmまで＝周辺）→ 同じ旧5桁で物件の多い町（「〇〇周辺」）
export function blurName(a, zoneLabel) {
  const sc = a && (a.schools?.elementary || a.school);
  if (sc) return sc.replace(/(市|区|町|村)立/, "$1").replace(/(小学校|学校)$/, "") + "学区";
  const s = a && (a.stations || [])[0];
  if (s && s.d <= 800) return s.name + "駅徒歩圏";
  if (s && s.d <= 2000) return s.name + "駅周辺";
  return zoneLabel || null;
}

// top：HPのトップのURL。lookup(lat, lng)：周りのデータ（学区・駅）。返り値は管理画面に出す形
export async function listings(top, { lookup, dataDir, limitMs = 45000 } = {}) {
  const t0 = Date.now(), late = () => Date.now() - t0 > limitMs;
  const r = { found: [], how: [], areas: [], external: [], towns: 0 };
  const t = await get(top); if (!t.ok) { r.error = t.error || t.status; return r; }
  const p = parse(t.html, t.url), host = new URL(t.url).host;
  const cand = new Map();
  for (const l of p.links) {
    const s = l.label + " " + l.url; if (!BUY.test(s) || RENT.test(s)) continue;
    const h = new URL(l.url).host;
    if (h !== host && !h.endsWith("." + host.replace(/^www\./, ""))) { r.external.push(h); continue; }
    if (!cand.has(l.url)) cand.set(l.url, "リンク");
  }
  if (!cand.size) { const sm = await get(new URL("/sitemap.xml", t.url).href); if (sm.ok) for (const m of sm.html.matchAll(/<loc>([^<]+)<\/loc>/g)) if (BUY.test(m[1]) && !RENT.test(m[1])) cand.set(m[1], "サイトの地図"); }
  if (!cand.size) for (const g of GUESS) { if (late()) break; const u = new URL("/" + g, t.url).href; const x = await get(u); if (x.ok && x.html.length > 3000) cand.set(u, "よくある置き場所"); await sleep(300); }
  r.external = [...new Set(r.external)];
  const hits = []; // {pref, city, town, type}
  for (const [u, how] of [...cand].slice(0, 5)) {
    if (late()) break;
    await sleep(500); const x = await get(u); if (!x.ok) continue;
    const text = parse(x.html, x.url).text || ""; if (!/万円/.test(text)) continue; // 価格がなければ物件ページでない
    r.found.push(u); r.how.push(how);
    for (const w of towns(text)) hits.push({ pref: w.pref, city: w.city, town: w.town, type: typeOf(w.near) });
  }
  // 町ごとにまとめる → 旧5桁で丸めた呼び名（物件の多い町）
  const byTown = new Map();
  for (const h of hits) { const k = h.city + h.town; if (!byTown.has(k)) byTown.set(k, { ...h, n: 0, types: {} }); const x = byTown.get(k); x.n++; if (h.type) x.types[h.type] = (x.types[h.type] || 0) + 1; }
  r.towns = byTown.size;
  const zone = new Map();
  for (const x of byTown.values()) { x.z5 = zoneOf(dataDir, x.city, x.town); const zk = x.z5 ? x.city + "#" + x.z5 : "?" + x.city + x.town; if (!zone.has(zk)) zone.set(zk, []); zone.get(zk).push(x); }
  for (const list of zone.values()) { list.sort((a, b) => b.n - a.n); const lab = list.length > 1 ? list[0].city + list[0].town + "周辺" : list[0].city; /* 町が1つだけなら町名を出さず市区町村まで */ for (const x of list) x.zoneLabel = x.z5 ? lab : list[0].city; }
  // 多い町から8つ、座標 → 学区・駅（国土地理院の住所検索）
  const groups = new Map();
  for (const x of [...byTown.values()].sort((a, b) => b.n - a.n).slice(0, 8)) {
    if (late()) break;
    let name = null;
    try {
      await sleep(400);
      const g = await (await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(x.pref + x.city + x.town), { signal: AbortSignal.timeout(8000) })).json();
      if (g[0] && lookup) { const [lng, lat] = g[0].geometry.coordinates; name = blurName(await lookup(lat, lng), x.zoneLabel); }
    } catch { /* 取れなければ郵便番号の丸め */ }
    name ||= x.zoneLabel;
    if (!groups.has(name)) groups.set(name, { area: name, n: 0, types: {} });
    const gr = groups.get(name); gr.n += x.n; for (const [k, v] of Object.entries(x.types)) gr.types[k] = (gr.types[k] || 0) + v;
  }
  r.areas = [...groups.values()].sort((a, b) => b.n - a.n).map((g) => ({ area: g.area, n: g.n, types: Object.entries(g.types).sort((a, b) => b[1] - a[1]).map(([k]) => k) }));
  r.ms = Date.now() - t0;
  return r;
}

// 管理画面・AIへ渡す一文：「明倫学区：古家付きの土地・農地／由良川学区：土地」
export const areasText = (r) => (r.areas || []).slice(0, 6).map((a) => a.area + (a.types.length ? "：" + a.types.slice(0, 3).join("・") : "")).join("／");
