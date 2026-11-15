// 町名を郵便番号の旧5桁（配達区域）でまとめ、物件の多い町の名前に丸める。data/postal/utf_ken_all.csv を使う。
import fs from "fs";

let IDX = null; // "市区町村" → [{town, z5}]
function load() {
  if (IDX) return IDX;
  IDX = new Map();
  const csv = fs.readFileSync(new URL("../data/postal/utf_ken_all.csv", import.meta.url), "utf8");
  for (const line of csv.split(/\r?\n/)) {
    const f = line.split(",").map((s) => s.replace(/^"|"$/g, ""));
    if (f.length < 9) continue;
    const town = f[8].replace(/（.*$|\(.*$/, "").trim();
    if (!town || /以下に掲載がない場合|の次に番地がくる場合/.test(town)) continue;
    const city = f[7].replace(/^.+?郡(?=.+[町村]$)/, "");
    if (!IDX.has(city)) IDX.set(city, []);
    IDX.get(city).push({ town, z5: f[1].trim() });
  }
  return IDX;
}

// city と town（「大通東」「田村町金屋」など）から旧5桁を探す。一番長く一致した町を採る。
export function zoneOf(city, town) {
  const list = load().get(city); if (!list) return null;
  let best = null;
  for (const e of list) if (town.startsWith(e.town) && (!best || e.town.length > best.town.length)) best = e;
  return best ? best.z5 : null;
}

// counts: {"郡山市田村町金屋": 3, ...}（市区町村名＋町名）、cityOf(k) で市区町村名を返す
export function round(counts, cityOf) {
  const g = new Map();
  for (const [k, n] of Object.entries(counts)) {
    const city = cityOf(k); const town = k.slice(city.length);
    const z = zoneOf(city, town);
    const key = z ? city + "#" + z : "?" + k;
    if (!g.has(key)) g.set(key, { zone: z, city, towns: {}, n: 0 });
    const x = g.get(key); x.towns[town] = (x.towns[town] || 0) + n; x.n += n;
  }
  return [...g.values()].map((x) => {
    const top = Object.entries(x.towns).sort((a, b) => b[1] - a[1])[0][0];
    return { label: x.city + top + (Object.keys(x.towns).length > 1 ? "周辺" : ""), zone: x.zone, n: x.n, towns: x.towns };
  }).sort((a, b) => b.n - a.n);
}
