// 周り（作業用データ）：/api/around の結果を、AIへの説明の一節にする（タイプ2・3共通）。画面の表には出さない
// 芯：周りは「買う人・借りる人の物差し」。持ち主に買う人の目を貸し、上げも下げもしない。引き出しの問いは、持ち主の方が詳しいことを聞く
async function loadAround(s0, lat, lng) {
  try {
    const x = await fetch(`../api/around?lat=${lat}&lng=${lng}`, { signal:AbortSignal.timeout(20000) });
    if (x.ok && S === s0) { const a = await x.json(); if (!a.none && !a.error) S.around = a; }
  } catch (e) { /* 取れなくても体験は止めない。周りの話をしないだけ */ }
}
const km = d => d >= 1000 ? `約${(d / 1000).toFixed(1)}km` : `約${Math.round(d / 10) * 10}m`;
// 用途地域と相談の目的から、主に見るもの（レンズ）を決める
function aroundLens(zone, purpose) {
  const z = String(zone || ""), p = String(purpose || "");
  const byZone = /工業/.test(z) && !/準工業/.test(z) ? "work" : /商業/.test(z) ? "shop" : "home";
  const byPurpose = /貸/.test(p) ? "rent" : /売|手放|買取|査定|相場/.test(p) ? "sell" : /残|迷|相続|将来|税/.test(p) ? "keep" : "";
  return { byZone, byPurpose };
}
function aroundText(a, zone, purpose, n) {
  if (!a) return "";
  const L = aroundLens(zone, purpose), out = [];
  const st = Array.isArray(a.stations) ? a.stations : [];
  if (st.length) out.push("・最寄りの駅：" + st.map(s => `${s.name}駅（${s.lines}）直線${km(s.d)}` + (s.pax ? `、乗降客数 約${Math.round(s.pax / 100) * 100}人/日` : "")).join(" ／ "));
  const sc = a.schools || {};
  if (L.byZone !== "work" && (sc.elementary || sc.junior)) out.push("・学区：" + [sc.elementary && sc.elementary + "区", sc.junior && sc.junior + "区"].filter(Boolean).join("・"));
  const sh = a.shops || {}, order = ["スーパー", "コンビニ", "ドラッグストア", "ショッピングセンター", "ホームセンター"];
  const shopLine = order.filter(k => sh[k] && sh[k].length).map(k => `${k} ${km(sh[k][0].d)}` + (sh[k][0].name ? `（${sh[k][0].name}）` : "")).join("、");
  if (L.byZone !== "work" && shopLine) out.push("・暮らしの店（地図データ OpenStreetMap。名前・種類は誤りや閉店の反映漏れがありえます）：" + shopLine);
  const hz = a.hazards || {};
  if (!hz.error) {
    const h = [hz.flood && "洪水 " + hz.flood, hz.surge && "高潮 " + hz.surge, hz.tsunami && "津波 " + hz.tsunami, hz.sediment && hz.sediment].filter(Boolean);
    out.push("・災害の想定：" + (h.length ? h.join("／") : "洪水・高潮・津波・土砂災害の想定区域には入っていません"));
  }
  const po = a.population;
  if (po && po.now) out.push(`・人の増減（このあたり250m四方の推計）：2025年 約${po.now}人 → 2045年 約${po.y2045}人（${po.change >= 0 ? "約" + po.change + "%増" : "約" + (-po.change) + "%減"}）`);
  const pl = a.plan || {};
  if (pl.division) out.push("・区域：" + pl.division + (pl.residence ? `、居住誘導区域の${pl.residence}` : "") + (pl.urban ? "（都市機能誘導区域）" : ""));
  if (!out.length) return "";
  const lensTxt = { home:"住まいの土地として、駅・学区・暮らしの店・災害・人の増減", shop:"商いの土地として、駅の乗降客数・人の増減・災害", work:"仕事の土地として、駅・災害（学区や暮らしの店は見ません）" }[L.byZone];
  const purTxt = { sell:"売るなら、買う人が最初に見るもの（学区・駅・暮らしの店）", rent:"貸すなら、借りる人が見るもの（駅と乗降客数）", keep:"残す・迷うなら、この先の手がかり（人の増減・居住誘導区域・災害）" }[L.byPurpose] || "";
  return "\n\n【周り（国の公開データ・地図データ。距離は直線）】\n" + out.join("\n")
    + `\n主に見るもの：${lensTxt}` + (purTxt ? `。相談の目的からは、${purTxt}` : "") + "。"
    + "\n【周りの使い方】"
    + "\n- 周りは、買う人・借りる人が見る物差しです。持ち主に「買う人の目」として事実を渡します。上げも下げもしません（「人気」「すぐ売れる」「難しい」と評価しない）。弱みは、確かめること・手を打てることとして言います。"
    + `\n- ${n === 0 ? "この返事では、敷地の話に、周りの事実を一つだけ添えます。" : "一つの返事で触れる周りの事実は一つまで。話の流れと重なるときだけ使います。"}出どころ（国の公開データ／地図データ）と直線距離で言い、徒歩何分・「駅近」とは言いません。`
    + "\n- 事実を渡したあと、その場所について持ち主の方が詳しいことを一つ聞いてよいです（例：実際に歩くとどんな道か、周りで空き家は増えたか、暮らしてみての良さ）。答えは「買う方に伝わる良さ」として受け止めます。"
    + "\n- 店や施設の名前は、ここにあるものだけを使います。ここにない店を足さず、ここにない種類の店について「近くにない」とは言いません。"
    + "\n- 人の増減と居住誘導区域は、値段の予想にせず、考える時期の手がかりとして言います。急かしません。災害の想定は隠さず、あおらず、一言で伝えて「現地と対策は担当が確かめます」につなげます。";
}
