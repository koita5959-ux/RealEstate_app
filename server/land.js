// 公開データ（国土交通省「不動産情報ライブラリ」API）：ピンの位置の用途地域と、最寄りの地価公示・地価調査の地点
// ・キーは secrets/reinfolib_api_key.txt（Git外）。サーバーからだけ呼ぶ（ブラウザから直接呼ばない案内あり）
// ・キーがない間は、実在しない「見本」の値を返す（画面の見え方を先に確かめるため）
// ・一度取ったタイルは data/reinfolib/ に保存して使い回す。外へ出す呼び出しは間隔をあける（回数上限は明示なし・呼びすぎで制限あり）
// ・画面には必ず出典の一文を出す（SOURCE_NOTE）
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external/";
export const SOURCE_NOTE = "このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。";
const TTL_MS = 30 * 24 * 3600_000; // 地価は年1〜2回、用途地域も滅多に変わらない
const TTL_EMPTY_MS = 24 * 3600_000; // 空の結果（今年分がまだ出ていない等）は1日で取り直す
const GAP_MS = 400; // 外へ出す呼び出しの間隔

export function landSetup({ keyFile, dataDir }) {
  let key = "";
  try { key = fs.readFileSync(keyFile, "utf8").trim(); } catch { /* なければ見本 */ }
  const cacheDir = path.join(dataDir, "reinfolib");
  fs.mkdirSync(cacheDir, { recursive: true });

  let last = 0, chain = Promise.resolve();
  const slot = () => (chain = chain.then(async () => { const w = last + GAP_MS - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); last = Date.now(); }));

  async function tile(api, q) {
    const qs = new URLSearchParams({ response_format: "geojson", ...q }).toString();
    const file = path.join(cacheDir, `${api}_${qs.replace(/[^0-9a-z_=-]/gi, "_")}.json`);
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Date.now() - c.at < (c.features.length ? TTL_MS : TTL_EMPTY_MS)) return c.features;
    } catch { /* 保存なし */ }
    await slot();
    const r = await fetch(BASE + api + "?" + qs, { headers: { "Ocp-Apim-Subscription-Key": key }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`${api} ${r.status}`);
    const j = await r.json();
    const features = Array.isArray(j.features) ? j.features : [];
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), features }));
    return features;
  }

  async function lookup(lat, lng) {
    if (!key) return sample(lat, lng);
    const [zone, point] = await Promise.all([zoneAt(lat, lng).catch(e => ({ error: e.message })), nearestPoint(lat, lng).catch(e => ({ error: e.message }))]);
    return { source: "api", zone, point, note: SOURCE_NOTE };
  }

  // 用途地域：ピンを含む z15 タイルを取り、ピンを含む区域を探す。なければ「指定なし」
  async function zoneAt(lat, lng) {
    const t = tileOf(lat, lng, 15);
    const fs_ = await tile("XKT002", { z: 15, x: t.x, y: t.y });
    const f = fs_.find(f => inGeom(lng, lat, f.geometry));
    if (!f) return { none: true };
    const p = f.properties || {};
    return { name: p.use_area_ja || "", bcr: p.u_building_coverage_ratio_ja || "", far: p.u_floor_area_ratio_ja || "", city: p.city_name || "" };
  }

  // 地価公示・地価調査：ピンを含む z13 タイルと、ピンに近い側の隣 3 枚（計 2×2）。今年の分がなければ前年
  async function nearestPoint(lat, lng) {
    const t = tileOf(lat, lng, 13);
    const xs = [t.x, t.x + (t.fx < 0.5 ? -1 : 1)], ys = [t.y, t.y + (t.fy < 0.5 ? -1 : 1)];
    const y0 = new Date().getFullYear();
    for (const year of [y0, y0 - 1]) {
      const all = [];
      for (const x of xs) for (const y of ys) all.push(...await tile("XPT002", { z: 13, x, y, year }));
      const pts = all.filter(f => f.geometry && f.geometry.type === "Point" && !(f.properties || {}).pause_flag)
        .map(f => ({ f, d: distM(lat, lng, f.geometry.coordinates[1], f.geometry.coordinates[0]) })).sort((a, b) => a.d - b.d);
      if (pts.length) return pointOut(pts[0].f.properties || {}, pts[0].d, year);
    }
    return { none: true };
  }

  return { lookup, hasKey: !!key, tile }; // tile は周り（around.js）も使う
}

function pointOut(p, d, year) {
  return {
    d: Math.round(d), year, yearName: p.target_year_name_ja || String(year),
    kind: /7月1日/.test(p.target_year_name_ja || "") ? "地価調査" : "地価公示", /* 基準日で分ける（公示＝1月1日・調査＝7月1日） */ number: p.standard_lot_number_ja || "",
    location: p.location || p.location_number_ja || "", address: p.residence_display_name_ja || "",
    price: p.u_current_years_price_ja || "", lastPrice: p.last_years_price ?? "", change: p.year_on_year_change_rate ?? "",
    use: p.use_category_name_ja || "", cadastral: p.u_cadastral_ja || "", shape: p.shape || "",
    usage: p.usage_status_name_ja || "", building: [p.building_structure_name_ja, p.u_ground_hierarchy_ja && "地上" + p.u_ground_hierarchy_ja, p.u_underground_hierarchy_ja && "地下" + p.u_underground_hierarchy_ja].filter(Boolean).join("・"),
    surround: p.current_usage_status_of_surrounding_land_name_ja || "",
    road: [p.front_road_azimuth_name_ja, p.front_road_name_ja, p.front_road_width && (Number(String(p.front_road_width).replace(/,/g, "")) / 10).toFixed(1) + "m", p.front_road_pavement_condition === "1" || p.front_road_pavement_condition === 1 ? "舗装" : p.front_road_pavement_condition] /* 幅は0.1m単位（60＝6.0m）、舗装は「1」 */.filter(Boolean).join("・"),
    side: [p.side_road_azimuth_name_ja, p.side_road_name_ja].filter(Boolean).join("・"),
    station: p.nearest_station_name_ja || "", stationDist: p.u_road_distance_to_nearest_station_name_ja || "",
    water: p.water_supply_availability ?? "", gas: p.gas_supply_availability ?? "", sewer: p.sewer_supply_availability ?? "",
    division: p.area_division_name_ja || "", zone: p.regulations_use_category_name_ja || "",
    bcr: p.u_regulations_building_coverage_ratio_ja || "", far: p.u_regulations_floor_area_ratio_ja || "",
    fire: p.regulations_fireproof_name_ja || "", altitude: p.regulations_altitude_district_name_ja || "",
  };
}

// 見本：キーが届くまでの、実在しない値（地点はピンの北東約300mに置く）
function sample(lat, lng) {
  return {
    source: "sample", note: SOURCE_NOTE,
    zone: { name: "第一種住居地域", bcr: "60%", far: "200%", city: "" },
    point: {
      d: 300, year: new Date().getFullYear(), yearName: "見本", kind: "地価公示", number: "見本-1",
      location: "見本町1丁目1番", address: "", price: "100,000(円/㎡)", lastPrice: "99,000", change: "1.0",
      use: "住宅地", cadastral: "200(㎡)", shape: "1.0:1.5", usage: "住宅", building: "W（木造）・地上2",
      surround: "一般住宅が建ち並ぶ住宅地域", road: "南・市道・6.0m・舗装", side: "",
      station: "見本駅", stationDist: "1,200m", water: "有", gas: "有", sewer: "有",
      division: "市街化区域", zone: "1中専", bcr: "60(%)", far: "200(%)", fire: "準防", altitude: "",
    },
  };
}

function tileOf(lat, lng, z) {
  const n = 2 ** z, xf = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180, yf = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x: Math.floor(xf), y: Math.floor(yf), fx: xf % 1, fy: yf % 1 };
}
function distM(a1, o1, a2, o2) {
  const R = 6371000, t = x => x * Math.PI / 180, dA = t(a2 - a1), dO = t(o2 - o1);
  const s = Math.sin(dA / 2) ** 2 + Math.cos(t(a1)) * Math.cos(t(a2)) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (x, y, rings) => rings.length && inRing(x, y, rings[0]) && !rings.slice(1).some(h => inRing(x, y, h));
function inGeom(x, y, g) {
  if (!g) return false;
  if (g.type === "Polygon") return inPoly(x, y, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some(p => inPoly(x, y, p));
  return false;
}
export const _test = { tileOf, inGeom, pointOut, distM };
