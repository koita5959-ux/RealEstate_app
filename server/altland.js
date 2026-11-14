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
    const dir = (x) => bearing(lat, lng, x.lat, x.lng);
    return { dir, here: { where: here.addr, price: here.price, d: Math.round(here.d) }, area, value: here.price * area, list, n: list.length };
  }

  // 同じセッションでは一度だけ探す（失敗したら次の往復で探し直す）
  async function forSid(sid, lat, lng, area, said) {
    const base = await baseFor(sid, lat, lng, area);
    return base.none ? base : choose(base, readWish(said, base.value));
  }
  function baseFor(sid, lat, lng, area) {
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

// ㎡と坪（土地の会話では混ざるのがふつう。計算は㎡にそろえ、見せるときは両方）
const TSUBO = 3.30578;
const num = (t) => Number(String(t).replace(/[,，]/g, "").replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
const fmtArea = (m2, unit) => { const a = `約${Math.round(m2).toLocaleString()}㎡`, b = `約${Math.round(m2 / TSUBO).toLocaleString()}坪`; return unit === "坪" ? `${b}（${a}）` : `${a}（${b}）`; };
const fmtUnit = (p, unit) => { const a = `${Math.round(p).toLocaleString()}円/㎡`, b = `約${(Math.round(p * TSUBO / 1000) / 10).toLocaleString()}万円/坪`; return unit === "坪" ? `${b}（${a}）` : `${a}（${b}）`; };
const man = (v) => Math.round(v / 10000).toLocaleString() + "万円";

// 客の発言から、移り先の広さ・予算・よく使う単位を読む（後の発言ほど優先。おおよそで良い）
export function readWish(said, value) {
  const w = { unit: "㎡" };
  for (const t of (said || []).map(String)) {
    const areas = [...t.matchAll(/([0-9０-９][0-9０-９,，.．]*)\s*(坪|㎡|m2|ｍ２|平米|平方メートル)/g)].map((m) => ({ m2: num(m[1]) * (m[2] === "坪" ? TSUBO : 1), unit: m[2] === "坪" ? "坪" : "㎡" })).filter((a) => a.m2 >= 30);
    if (areas.length) { const big = areas.reduce((a, b) => (b.m2 > a.m2 ? b : a)); w.area = big.m2; w.unit = big.unit; } // 「300㎡で畑が40坪」なら敷地の300㎡
    const money = [...t.matchAll(/([0-9０-９][0-9０-９,，.．]*)\s*(億|千万|万)\s*円?/g)].map((m) => num(m[1]) * { 億: 1e8, 千万: 1e7, 万: 1e4 }[m[2]]).filter((v) => v >= 1e5);
    if (money.length) w.budget = Math.max(...money);
  }
  w.from = [w.budget ? "予算はお話より" : "予算は今の土地の目安", w.area ? "広さはお話より" : "広さは今の1.5倍を仮に"].join("・");
  w.budget ||= value;
  return w;
}

// 予算÷広さ＝必要な単価。それ以下の地点を、近い順に距離の帯ごとに選ぶ
function choose(base, w) {
  const area = w.area || base.area * 1.5;
  const limit = w.budget / area;
  const ok = base.list.filter((x) => x.d > 2000 && x.price <= limit);
  const pick = (lo, hi, n) => ok.filter((x) => x.d > lo && x.d <= hi).slice(0, n);
  let fit = [...pick(2000, 10000, 2), ...pick(10000, 20000, 2)];
  const near = !fit.length; // 当てはまる所がなければ、いちばん安い所を「届かないが近い」として出す
  if (near) fit = base.list.filter((x) => x.d > 2000).sort((a, b) => a.price - b.price).slice(0, 2);
  const cands = fit.map((x) => ({ where: x.addr, km: Math.round(x.d / 100) / 10, dir: base.dir(x), use: x.use, price: x.price, division: x.division, surround: x.surround,
    buy: Math.round(w.budget / x.price), times: Math.round((w.budget / x.price / base.area) * 10) / 10 }));
  const { list, dir, ...rest } = base;
  return { ...rest, want: { budget: w.budget, area, unit: w.unit, limit, from: w.from }, near, cands,
    show: cands.map((c) => `${c.where}（${c.dir}約${c.km}km・${c.use}）${fmtUnit(c.price, w.unit)} → ${man(w.budget)}で${fmtArea(c.buy, w.unit)}`) };
}

// AIへ渡す表（数字はここで作ったものだけを使わせる）
export function altlandText(r) {
  if (!r || r.none) return `【代替え地の例えば】${r ? r.none : "探し中"}。数字は出さず、どんな所を探すかの形で話します。`;
  const u = r.want.unit;
  return `【代替え地の例えば（国の標準地の値での単純計算。どれも別の土地の値で、売り物ではありません）】
今の土地の目安：最寄りの標準地 ${fmtUnit(r.here.price, u)} × ${fmtArea(r.area, u)} ＝ 約${man(r.value)}
探す条件（${r.want.from}）：${man(r.want.budget)}で${fmtArea(r.want.area, u)} → 単価 ${fmtUnit(r.want.limit, u)} 以下の所
${r.near ? "20km圏に条件に届く標準地はありませんでした。いちばん近い値の所：" : "20km圏で条件に合う地点（近い順）："}
${r.show.map((l, i) => `${i + 1}. ${l}`).join("\n")}
使い方：地域名（市町村と町・字まで。番地は言わない）を先に出し、「例えば◯◯のあたり（方角・距離）なら、国の標準地の値で単純に計算すると、${man(r.want.budget)}で約◯坪（◯㎡）」の形で、一つか二つ挙げます。利用者が坪で話していれば坪を先に、㎡なら㎡を先に言います。地目や用途が違っても構いません。値段や買えることは約束しません。条件に届かないときは、そう正直に言い、どのくらい足りないかを示します。`;
}
