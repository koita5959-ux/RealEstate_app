// 周り（作業用データ）：ピンの周りを、無料の公開データで読む。画面の表には出さず、AIへの説明に入れる（2026-11-11）
// ・国土交通省「不動産情報ライブラリ」：駅と乗降客数（XKT015）、小・中学校区（XKT004・005）、洪水・高潮・津波・土砂（XKT026〜029）、
//   将来推計人口 250mメッシュ（XKT013）、立地適正化計画（XKT003）、区域区分（XKT001）。キー・保存・間隔は land.js と同じ仕組み
// ・OpenStreetMap：スーパー・コンビニなど（data/osm/poi-*.json。server/poi_extract.py で月に1回ほど作る）
// 距離はすべて直線。徒歩分数には直さない（広告の徒歩分数は道路距離80m＝1分の決まりがあるため）
import fs from "node:fs";
import path from "node:path";

const FLOOD_RANK = { 1: "0.5m未満", 2: "0.5〜3m", 3: "3〜5m", 4: "5〜10m", 5: "10〜20m", 6: "20m以上" }; // 国土数値情報 A31a の浸水深ランク
const SEDIMENT = { 1: "急傾斜地の崩壊", 2: "土石流", 3: "地すべり" };

export function aroundSetup({ tile, dataDir }) {
  // 店（OpenStreetMap）：起動時に読み、0.01度の升目で引けるようにする
  const grid = new Map(); let poiSource = "";
  try {
    for (const f of fs.readdirSync(path.join(dataDir, "osm")).filter((f) => /^poi-.*\.json$/.test(f))) {
      const j = JSON.parse(fs.readFileSync(path.join(dataDir, "osm", f), "utf8"));
      poiSource = j.source || poiSource;
      for (const p of j.poi) { const k = `${Math.floor(p[3] * 100)}_${Math.floor(p[4] * 100)}`; (grid.get(k) || grid.set(k, []).get(k)).push(p); }
    }
  } catch { /* 店のデータがなければ、店は出さない */ }

  function shops(lat, lng) {
    const near = [];
    const a = Math.floor(lat * 100), o = Math.floor(lng * 100);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const p of grid.get(`${a + i}_${o + j}`) || []) near.push({ kind: p[0], name: p[1], d: Math.round(distM(lat, lng, p[3], p[4])) });
    const out = {};
    for (const p of near.sort((x, y) => x.d - y.d)) {
      if (p.d > 1500) break;
      const list = out[p.kind] || (out[p.kind] = []);
      if (list.length < 2 && !(p.name && list.some((x) => x.name === p.name))) list.push(p);
    }
    return out;
  }

  const tile2x2 = async (api, lat, lng, z) => {
    const t = tileOf(lat, lng, z), xs = [t.x, t.x + (t.fx < 0.5 ? -1 : 1)], ys = [t.y, t.y + (t.fy < 0.5 ? -1 : 1)], all = [];
    for (const x of xs) for (const y of ys) all.push(...await tile(api, { z, x, y }));
    return all;
  };
  const at = async (api, lat, lng, z) => { const t = tileOf(lat, lng, z); return (await tile(api, { z, x: t.x, y: t.y })).filter((f) => inGeom(lng, lat, f.geometry)); };
  const safe = (p) => p.catch((e) => ({ error: e.message }));

  async function stations(lat, lng) {
    const by = new Map();
    for (const f of await tile2x2("XKT015", lat, lng, 13)) {
      const p = f.properties || {}, name = p.S12_001_ja; if (!name) continue;
      const d = minDist(lat, lng, f.geometry);
      const pax = [2024, 2023, 2022].map((y) => +p[`${y}_passenger_count`] || 0).find((v) => v > 0) || 0;
      const s = by.get(name) || { name, d, lines: new Set(), pax: 0 };
      s.d = Math.min(s.d, d); if (p.S12_003_ja) s.lines.add(p.S12_003_ja); s.pax += pax; by.set(name, s);
    }
    return [...by.values()].sort((a, b) => a.d - b.d).slice(0, 2).map((s) => ({ name: s.name, d: Math.round(s.d), lines: [...s.lines].join("・"), pax: s.pax }));
  }
  async function schools(lat, lng) {
    const e = (await at("XKT004", lat, lng, 13))[0], j = (await at("XKT005", lat, lng, 13))[0];
    return { elementary: e ? e.properties.A27_004_ja : "", junior: j ? j.properties.A32_004_ja : "" };
  }
  async function hazards(lat, lng) {
    const fl = await at("XKT026", lat, lng, 14), ss = await at("XKT027", lat, lng, 13), ts = await at("XKT028", lat, lng, 14), sd = await at("XKT029", lat, lng, 13);
    const rank = Math.max(0, ...fl.map((f) => +f.properties.A31a_205 || 0));
    return {
      flood: rank ? `${FLOOD_RANK[rank] || "想定あり"}（${[...new Set(fl.map((f) => f.properties.A31a_202).filter(Boolean))].slice(0, 2).join("・")}）` : "",
      surge: ss.map((f) => f.properties.A49_003).filter(Boolean)[0] || "",
      tsunami: ts.map((f) => f.properties.A40_003).filter(Boolean)[0] || "",
      sediment: sd.map((f) => `${SEDIMENT[f.properties.A33_001] || "土砂災害"}の${+f.properties.A33_002 === 2 ? "特別警戒区域" : "警戒区域"}`)[0] || "",
    };
  }
  async function population(lat, lng) {
    const m = (await at("XKT013", lat, lng, 13))[0]; if (!m) return null;
    const p = m.properties, a = +p.PT00_2025 || 0, b = +p.PT00_2045 || 0;
    return a > 0 ? { now: Math.round(a), y2045: Math.round(b), change: Math.round((b / a - 1) * 100) } : null;
  }
  async function plan(lat, lng) {
    const k = (await at("XKT001", lat, lng, 13)).map((f) => f.properties.area_classification_ja);
    const r = (await at("XKT003", lat, lng, 13)).map((f) => f.properties.kubun_name_ja);
    return {
      division: k.find((x) => /市街化/.test(x)) || (k.includes("都市計画区域") ? "非線引きの都市計画区域" : k.length ? k[0] : "都市計画区域外"),
      residence: r.includes("居住誘導区域") ? "内" : r.includes("立地適正化計画区域") ? "外" : "", // 計画のない市は空
      urban: r.includes("都市機能誘導区域"),
    };
  }

  async function lookup(lat, lng) {
    const [st, sc, hz, po, pl] = [await safe(stations(lat, lng)), await safe(schools(lat, lng)), await safe(hazards(lat, lng)), await safe(population(lat, lng)), await safe(plan(lat, lng))];
    return { stations: st, schools: sc, hazards: hz, population: po, plan: pl, shops: shops(lat, lng), shopSource: poiSource };
  }
  return { lookup };
}

function tileOf(lat, lng, z) {
  const n = 2 ** z, xf = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180, yf = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x: Math.floor(xf), y: Math.floor(yf), fx: xf % 1, fy: yf % 1 };
}
function distM(a1, o1, a2, o2) {
  const R = 6371000, t = (x) => x * Math.PI / 180, dA = t(a2 - a1), dO = t(o2 - o1);
  const s = Math.sin(dA / 2) ** 2 + Math.cos(t(a1)) * Math.cos(t(a2)) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function minDist(lat, lng, g) { // 駅は線（ホーム）で描かれている。頂点までの距離の最小で足りる
  const pts = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.type === "MultiLineString" ? g.coordinates.flat() : [];
  return Math.min(...pts.map((c) => distM(lat, lng, c[1], c[0])), Infinity);
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (x, y, rings) => rings.length && inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));
function inGeom(x, y, g) {
  if (!g) return false;
  if (g.type === "Polygon") return inPoly(x, y, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => inPoly(x, y, p));
  return false;
}
