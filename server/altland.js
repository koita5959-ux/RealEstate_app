// 代替え地の「例えば」（試験用・2026-11-14）
// きっかけ（代替え地）が発動したときだけ、ピンから20km圏の地価公示・地価調査の地点を拾い、
// 「今の土地の目安（最寄りの標準地の価格×面積）と同じ額で、どこなら何㎡か」を数点選ぶ。
// ・地目は問わない（住宅地・商業地・林地など）。土地の評価は国交省の標準地の値での単純計算（ユーザーの視点）
// ・20km圏を全部取ると初回に約120タイル（約50秒）かかるので、8方位×5/10/15/20kmの地点を含むタイルだけ取る（間引き）
// ・結果は sid ごとに覚える。タイルは land.js の保存（30日）を使い回す
import { _test } from "./land.js";
const { tileOf, distM } = _test;

const DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
const yen = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

function offset(lat, lng, km, deg) { // deg：北から時計回り
  const r = (deg * Math.PI) / 180;
  return [lat + (km / 111.32) * Math.cos(r), lng + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(r)];
}
function bearing(lat1, lng1, lat2, lng2) {
  const t = (x) => (x * Math.PI) / 180;
  const y = Math.sin(t(lng2 - lng1)) * Math.cos(t(lat2));
  const x = Math.cos(t(lat1)) * Math.sin(t(lat2)) - Math.sin(t(lat1)) * Math.cos(t(lat2)) * Math.cos(t(lng2 - lng1));
  const b = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return DIRS[Math.round(b / 45) % 8];
}

export function altlandSetup(land) {
  const memo = new Map(); // sid → Promise<結果>

  async function points(lat, lng, year) {
    const tiles = new Map();
    const add = (a, o) => { const t = tileOf(a, o, 13); tiles.set(t.x + "_" + t.y, t); };
    add(lat, lng);
    for (const km of [5, 10, 15, 20]) for (let k = 0; k < 8; k++) add(...offset(lat, lng, km, k * 45));
    const all = [];
    for (const t of tiles.values()) all.push(...(await land.tile("XPT002", { z: 13, x: t.x, y: t.y, year }).catch(() => [])));
    return all.filter((f) => f.geometry && f.geometry.type === "Point" && !(f.properties || {}).pause_flag);
  }

  async function search(lat, lng, area) {
    if (!land.hasKey) return { none: "公開データのキーがありません" };
    const y0 = new Date().getFullYear();
    let pts = [];
    for (const year of [y0, y0 - 1]) { pts = await points(lat, lng, year); if (pts.length) break; }
    if (!pts.length) return { none: "20km圏に標準地が見つかりません" };
    const list = pts.map((f) => {
      const p = f.properties || {}, [o, a] = f.geometry.coordinates;
      return { d: distM(lat, lng, a, o), lat: a, lng: o, price: yen(p.u_current_years_price_ja), use: p.use_category_name_ja || "",
        addr: p.location || p.residence_display_name_ja || "", surround: p.current_usage_status_of_surrounding_land_name_ja || "",
        division: p.area_division_name_ja || "", station: p.nearest_station_name_ja || "" };
    }).filter((x) => x.price > 0).sort((a, b) => a.d - b.d);
    const here = list[0];
    if (!here || here.d > 5000) return { none: "ピンの近く（5km以内）に標準地がなく、今の土地の目安を出せません" };
    const value = here.price * area;
    // 今の土地より安い地点（標準地の値で半分以下）を、距離の帯ごとに、同じ額で買える広さが大きい順に
    const cheap = list.filter((x) => x.d > 2000 && x.price <= here.price * 0.5);
    const pick = (lo, hi, n) => cheap.filter((x) => x.d > lo && x.d <= hi).sort((a, b) => a.price - b.price).slice(0, n);
    const cands = [...pick(2000, 10000, 2), ...pick(10000, 20000, 2)].map((x) => ({
      where: x.addr, km: Math.round(x.d / 100) / 10, dir: bearing(lat, lng, x.lat, x.lng), use: x.use, price: x.price,
      buy: Math.round(value / x.price), times: Math.round((value / x.price / area) * 10) / 10, surround: x.surround, division: x.division,
    }));
    return { here: { where: here.addr, price: here.price, d: Math.round(here.d) }, area, value, cands, n: list.length };
  }

  // 同じセッションでは一度だけ探す（失敗したら次の往復で探し直す）
  function forSid(sid, lat, lng, area) {
    const k = `${sid}|${lat.toFixed(4)},${lng.toFixed(4)}|${area}`;
    if (!memo.has(k)) {
      const p = search(lat, lng, area).catch((e) => ({ none: "取得に失敗しました（" + e.message + "）" }));
      memo.set(k, p);
      p.then((r) => { if (r.none && /失敗/.test(r.none)) memo.delete(k); });
      if (memo.size > 500) memo.delete(memo.keys().next().value);
    }
    return memo.get(k);
  }
  return { forSid };
}

// AIへ渡す表（数字はここで作ったものだけを使わせる）
export function altlandText(r) {
  if (!r || r.none) return `【代替え地の例えば】${r ? r.none : "探し中"}。数字は出さず、どんな所を探すかの形で話します。`;
  const man = (v) => Math.round(v / 10000).toLocaleString() + "万円";
  const lines = r.cands.map((c, i) => `${i + 1}. ${c.dir}へ約${c.km}km：${c.where}（${c.use}・${c.division || "区域不明"}）標準地 ${c.price.toLocaleString()}円/㎡ → 同じ額で約${c.buy.toLocaleString()}㎡（今の約${c.times}倍）${c.surround ? "。周り：" + c.surround : ""}`);
  return `【代替え地の例えば（国の標準地の値での単純計算。どれも別の土地の値で、売り物ではありません）】
今の土地の目安：最寄りの標準地 ${r.here.price.toLocaleString()}円/㎡ × ${r.area}㎡ ＝ 約${man(r.value)}
${lines.length ? "20km圏で、同じ額ならこのくらいの広さになる地点：\n" + lines.join("\n") : "20km圏に、今の土地の半分以下の値の標準地は見つかりませんでした。"}
使い方：利用者の望み（畑・広さなど）に合いそうなものを「例えば」として一つだけ挙げ、方角・距離・広さの倍率で話します。地目や用途が違っても構いません。値段や買えることは約束せず、「国の標準地の値で単純に計算すると」と前置きします。`;
}
