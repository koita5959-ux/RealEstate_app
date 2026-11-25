// 物件ページの探し方・町名の拾い方を試す（AIなし）。node tools/listing_probe.mjs <URLを1行ずつ> <出力JSON>
// 売買のみ。町名 → 国土地理院の住所検索で座標 → /api/around で学区・駅。
import fs from "fs";
import { get, parse } from "../core/server/shop/read.js";
import { round } from "./postal_round.mjs";

const MUNI = JSON.parse(fs.readFileSync(new URL("../pr-fudosan/web/data/muni.json", import.meta.url)));
const BUY = /物件|売買|売物件|売り物件|土地|売地|戸建|一戸建|中古|新築|分譲|マンション|bukken|property|estate|sale|baibai|tochi|kodate|search|list/i;
const RENT = /賃貸|貸家|貸地|貸店舗|rent|chintai|月極|駐車場/i;
const GUESS = ["bukken/", "property/", "estate/", "sale/", "baibai/", "tochi/", "search/", "list/", "buy/"];
const TYPE_WORDS = ["売地", "土地", "古家", "更地", "中古戸建", "中古一戸建", "新築戸建", "建売", "中古マンション", "マンション", "分譲地", "農地", "現況田", "現況畑", "地目：田", "地目：畑", "山林", "事業用", "店舗", "収益", "建築条件"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cities = [];
for (const [pref, list] of Object.entries(MUNI.munis || MUNI.cities || {})) for (const c of list) cities.push({ pref, c: String(typeof c === "string" ? c : c.name).replace(/\s/g, "") });

function towns(text) {
  const out = [];
  for (const { pref, c } of cities) {
    let i = text.indexOf(c);
    while (i >= 0 && out.length < 400) {
      const m = text.slice(i + c.length, i + c.length + 14).match(/^([^\s\d０-９,，、。()（）\[\]【】/／|:：・-]{1,10}?)(?=[\d０-９一二三四五六七八九十]|丁目|番|字|大字|\s|$|[、。,（(])/);
      if (m && !/^(内|周辺|全域|エリア|の|市|区|町$|村$)/.test(m[1])) out.push({ pref, city: c, at: i, end: i + c.length, town: m[1].replace(/大字|字/g, "") });
      i = text.indexOf(c, i + c.length);
    }
  }
  // 長い名前（岡山市北区）に含まれる短い名前（北区）を外し、一番多い都道府県だけ残す
  const keep = out.filter((a) => !out.some((b) => b !== a && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at));
  const votes = {}; for (const a of keep) votes[a.pref] = (votes[a.pref] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  return keep.filter((a) => a.pref === top);
}
function stations(text) { return [...text.matchAll(/「?([一-龥ァ-ヶー]{1,10})」?駅\s*(?:より|から)?\s*徒歩\s*([0-9０-９]{1,3})\s*分/g)].map((m) => m[1]); }

async function probe(top) {
  const r = { url: top, found: [], how: [], towns: {}, cityOf: {}, stations: {}, types: {}, external: [] };
  const t = await get(top); if (!t.ok) { r.error = t.status || t.error; return r; }
  const p = parse(t.html, t.url); const host = new URL(t.url).host;
  const cand = new Map();
  for (const l of p.links) {
    const s = l.label + " " + l.url; if (!BUY.test(s) || RENT.test(s)) continue;
    const h = new URL(l.url).host;
    if (h !== host && !h.endsWith("." + host.replace(/^www\./, ""))) { r.external.push(h); continue; }
    if (!cand.has(l.url)) cand.set(l.url, "リンク");
  }
  if (!cand.size) { // サイトの地図
    const sm = await get(new URL("/sitemap.xml", t.url).href);
    if (sm.ok) for (const m of sm.html.matchAll(/<loc>([^<]+)<\/loc>/g)) if (BUY.test(m[1]) && !RENT.test(m[1])) cand.set(m[1], "sitemap");
  }
  if (!cand.size) for (const g of GUESS) { const u = new URL("/" + g, t.url).href; const x = await get(u); if (x.ok && x.html.length > 3000) cand.set(u, "推測"); await sleep(300); }
  r.external = [...new Set(r.external)];
  const pages = [...cand].slice(0, 5);
  for (const [u, how] of pages) {
    await sleep(500); const x = await get(u); if (!x.ok) continue;
    const text = parse(x.html, x.url).text || ""; if (!/万円/.test(text)) continue; // 価格がなければ物件ページでない
    r.found.push(u); r.how.push(how);
    for (const w of towns(text)) { const k = `${w.city}${w.town}`; r.towns[k] = (r.towns[k] || 0) + 1; r.cityOf[k] = w.city; r.pref ||= w.pref; }
    for (const s of stations(text)) r.stations[s] = (r.stations[s] || 0) + 1;
    for (const w of TYPE_WORDS) { const n = text.split(w).length - 1; if (n) r.types[w] = (r.types[w] || 0) + n; }
  }
  r.rounded = round(r.towns, (k) => r.cityOf[k]); delete r.cityOf;
  // 多い町から8つだけ、座標 → 学区・駅
  r.geo = [];
  for (const [k, n] of Object.entries(r.towns).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    await sleep(400);
    try {
      const g = await (await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent((r.pref || "") + k))).json();
      const hit = g[0]; if (!hit) { r.geo.push({ town: k, n, miss: true }); continue; }
      const [lng, lat] = hit.geometry.coordinates;
      const a = await (await fetch(`http://127.0.0.1:8110/api/around?lat=${lat}&lng=${lng}`)).json();
      r.geo.push({ town: k, n, hit: hit.properties.title, school: a.schools?.elementary || a.elementary || "", station: (a.stations || [])[0]?.name || "", d: (a.stations || [])[0]?.d ?? null });
    } catch (e) { r.geo.push({ town: k, n, error: e.message }); }
  }
  // ぼかした呼び名：学区があれば「〇〇学区」、なければ駅（800m以内＝徒歩圏、2kmまで＝周辺、その先は使わない）、どちらもなければ郵便番号で丸めた名前
  const blur = {};
  for (const g of r.geo) { const b = g.school ? g.school.replace(/(市|区|町|村)立/, "$1").replace(/(小学校|学校)$/, "") + "学区" : g.station && g.d <= 800 ? g.station + "駅徒歩圏" : g.station && g.d <= 2000 ? g.station + "駅周辺" : (r.rounded.find((x) => g.town in x.towns || Object.keys(x.towns).some((t) => g.town.endsWith(t)))?.label || null); if (b) blur[b] = (blur[b] || 0) + g.n; }
  r.blur = Object.entries(blur).sort((a, b) => b[1] - a[1]);
  return r;
}

const [, , inF, outF] = process.argv;
const urls = fs.readFileSync(inF, "utf8").split(/\s+/).filter(Boolean);
const all = [];
for (const u of urls) { process.stderr.write(u + "\n"); all.push(await probe(u)); }
fs.writeFileSync(outF, JSON.stringify(all, null, 1));
