// ---- タイプ1（選択式・AIなし）の組み立て：メイン画面と管理画面の共通部品 ----
// 決まりは _works/2026-11-16_ClaudeAI_タイプ1初期設定/tryout.py の compose・fill・reply をそのまま移したもの。
// アプリの一式は data/type1_defaults.json（読むだけ）。店の設定（重視する業務内容・受けの差分）は localStorage「reType1」。
// 当てはめ案：_works/2026-11-16_ClaudeCode_タイプ1の当てはめ案.md
let T1D = null; // アプリの一式
async function t1Load() {
  if (!T1D) T1D = await (await fetch("data/type1_defaults.json", { cache:"no-cache" })).json();
  return T1D;
}
// ---- 店が組む選択の木（③から先）。保存は localStorage「reType1」（v:2。v:1 の「重視する業務内容」は読まない） ----
// 節：{ label, biz?（③：④⑤の初期値を借りる業態）, opt?（④：一式の options のキー）, nx?（⑤：options の next の一つ）,
//       text?（選んだときの返事を店が書いた文）, ask?（次の問いを店が書いた文）, kids?（ない＝初期値のまま。[]＝子なし＝問い合わせだけ） }
const T1_ASK3 = "この土地で考えられる道です。気になるものを選んでください。";
const T1_INQ = "ここまでの情報で問い合わせを送る";
function t1Default(items) { // HPから拾った見出し（なければ4業態）が③になる
  const top = items && items.length ? items.map(i => ({ label:i.label, biz:i.biz }))
    : ["b3", "b1", "b2", "b4"].map(b => ({ label:T1D.businesses[b].name, biz:b }));
  return { v:2, url:"", top };
}
function t1Shop() {
  try { const s = JSON.parse(localStorage.getItem("reType1")); if (s && s.v === 2 && Array.isArray(s.top)) return s; } catch (e) { /* 初期値 */ }
  return t1Default();
}
// 子の一覧。初期値のままの節は、一式から作る（③の子は試しの土地で入れ替わる）
function t1Kids(node, land) {
  if (node.kids) return node.kids;
  if (node.biz) {
    const c = t1Compose(land, [node.biz]);
    return c.main.concat(c.more).map(id => ({ label:T1D.options[id].label, opt:id,
      first:c.first && c.first.id === id ? c.first.why : undefined, grey:c.grey[id] ? { reason:c.grey[id].reason, goto:c.grey[id].goto } : undefined }));
  }
  if (node.opt) return (T1D.options[node.opt].next || []).map(n => ({ label:n.label, nx:n, kids:[] }));
  return [];
}
// 初期値のままの子を、今の一覧で固める（店が直すときだけ。土地しだいの印は外す）
function t1Fix(node, land) {
  if (!node.kids) node.kids = t1Kids(node, land).map(({ first, grey, ...n }) => n);
  return node.kids;
}
// 選んだときの返事（書かれた文があればそれ。穴は土地の値で埋める）
function t1Tpl(node, biz) {
  if (node.text != null) return node.text;
  if (node.opt) { const o = T1D.options[node.opt]; return [o.uke[biz] || o.uke._ || "", o.num || o.plain || ""].join(""); }
  if (node.nx) return node.nx.reply || "";
  return "";
}
function t1Text(node, land, biz) {
  if (node.text == null && node.opt) { const r = t1Reply(land, [biz], node.opt, { [node.opt]:biz }, null); return [r.uke, r.facts, r.body].join(""); }
  return t1Fill(t1Tpl(node, biz), land);
}
function t1AskOf(node) { return node.ask != null ? node.ask : node.opt ? T1D.options[node.opt].ask || "" : node.biz ? T1_ASK3 : ""; }
const T1_HOLE = /\{([^}]+)\}/g;
// 穴に値を入れる。値のない穴を含む文は、その一文ごと落とす（「現地で確認」には差し替えない）
function t1Fill(text, land) {
  return (String(text || "").match(/[^。]+。?/g) || []).filter(s => [...s.matchAll(T1_HOLE)].every(m => land.data[m[1]] != null && land.data[m[1]] !== ""))
    .map(s => s.replace(T1_HOLE, (_, h) => String(land.data[h]))).join("");
}
// ④の顔ぶれ。biz は重視する業務内容（順番つき）
function t1Compose(land, biz) {
  const D = T1D, O = D.options, R = D.rules, ids = [], origin = {};
  for (const b of biz) for (const i of (D.sets[b] || {})[land.cat] || []) if (!(i in origin)) { ids.push(i); origin[i] = b; } // 1番から埋め、重なりは一つに
  for (const r of R.tagBrings) if (land.tags.includes(r.tag) && !(r.option in origin)) { ids.push(r.option); origin[r.option] = "札"; } // 条件札が連れてくる
  const ok = ids.filter(i => (O[i].needs || []).every(h => land.data[h])); // 材料のない選択肢は出さない
  const grey = {};
  for (const i of ok) for (const g of O[i].grey || []) if (land.tags.includes(g.tag)) grey[i] = g;
  const live = ok.filter(i => !grey[i]);
  const hit = R.firstMark.find(r => land.tags.includes(r.tag) && live.includes(r.option) && (r.cats || [land.cat]).includes(land.cat));
  const first = hit ? { id:hit.option, why:hit.why } : null; // 決まりが当たったときだけ印
  if (first) { live.splice(live.indexOf(first.id), 1); live.unshift(first.id); }
  const order = live.concat(Object.keys(grey)); // 薄く出すものは後ろへ
  return { main:order.slice(0, R.max), more:order.slice(R.max), origin, first, grey };
}
// ボタンの下の一行
function t1Sub(land, i) {
  const o = T1D.options[i], R = T1D.rules;
  const sub = Object.entries(o.subWhen || {}).find(([t]) => land.tags.includes(t))?.[1] || o.sub;
  let line = t1Fill(sub, land) || o.subPlain;
  if (/\{目安額\}/.test(sub) && land.mismatch && land.data.目安額 && land.data.標準地の種類) line += t1Fill(R.mismatch.subSuffix, land); // 種類の違う標準地での計算は、ボタンの下でも断る
  return line;
}
// 選んだ後の返事：受け＋土地の一文＋中身＋問い
function t1Reply(land, biz, i, origin, shop) {
  const o = T1D.options[i];
  const uke = (shop && shop.uke && shop.uke[i]) || o.uke[origin[i]] || biz.map(b => o.uke[b]).find(Boolean) || o.uke._ || "";
  const facts = (o.facts || []).filter(t => land.tags.includes(t)).map(t => t1Fill(T1D.tagFacts[t], land)).join("");
  const num = t1Fill(o.num, land);
  return { uke, facts, body:num || o.plain, ask:o.ask, next:o.next.map(n => ({ ...n, text:t1Fill(n.reply, land) })) };
}

// ---- 画面の状態から、タイプ1の「土地」を作る（今の作りとのつなぎ目） ----
const T1_CAT = { "住んでいる家がある":"K1", "空き家・古い家がある":"K2", "何もない（更地）":"K3", "駐車場・畑など":"K4" };
const T1_UNSURE = ["わからない", "測ったことがない", "隣との境目がはっきりしない"];
const T1_TSUBO = 3.30578;
// 足し引きの率（土地価格比準表の考え方の、おおよそ）。今は server/altland.js の appraise と同じ値。タイプ2・3をこちらへそろえるのは「後で直す一覧」
const T1_ADJ = { corner:0.04, notCorner:-0.04, flag2m:-0.30, flag:-0.15, wide:0.03, narrow:-0.05, odd:-0.05 };
function t1Appraise(s, std) {
  const it = [], corner = s.B.includes("2つの道に面している（角）");
  if (corner && !std.corner) it.push(["角地", T1_ADJ.corner]);
  if (!corner && std.corner && s.A && s.A !== "わからない") it.push(["角地でない（標準地は角地）", T1_ADJ.notCorner]);
  if (s.N === "細い通路の奥にある") it.push(s.W === "2mない・狭い" ? ["通路2m未満", T1_ADJ.flag2m] : ["旗竿地", T1_ADJ.flag]);
  else if (s.A === "広い道に面している" && std.roadM && std.roadM < 4) it.push(["広い道", T1_ADJ.wide]);
  else if (s.N === "前の道が狭い（車がすれ違えない）" && (!std.roadM || std.roadM >= 4)) it.push(["細い道", T1_ADJ.narrow]);
  if (s.B.includes("細長い・形がいびつ")) it.push(["形がいびつ", T1_ADJ.odd]);
  return { it, rate:it.reduce((a, [, r]) => a + r, 0) };
}
const t1Num = v => Number(String(v ?? "").replace(/\(.*?\)/g, "").replace(/[^\d.\-]/g, ""));
const t1Man = v => { const m = Math.round(v / 10000); return m.toLocaleString(); }; // 万円の数字
const t1Unit = v => { const m = Math.floor(v / 10000), r = Math.round(v % 10000); return (m ? m + "万" : "") + (r ? r.toLocaleString() : "") + "円"; };
const t1Km = d => d >= 1000 ? `約${(d / 1000).toFixed(1)}km` : `約${Math.round(d / 10) * 10}m`;
function landOf(s, sheet, raw, around, area, place) {
  const tags = [], B = s.B || [];
  if (s.W === "2mない・狭い") tags.push("norebuild");
  if (s.N === "前の道が狭い（車がすれ違えない）") tags.push("setback");
  if (B.includes("2つの道に面している（角）")) tags.push("corner");
  if (B.includes("坂や段差がある・道路より高い（低い）")) tags.push("slope");
  if (B.includes("細長い・形がいびつ")) tags.push("odd");
  if (B.includes("車を置きにくい")) tags.push("nocar");
  if (B.includes("隣との境目がはっきりしない")) tags.push("border");
  if ([s.A, s.W, ...B].some(x => T1_UNSURE.includes(x))) tags.push("unsure");
  const cat = T1_CAT[s.C] || "K1", d = {};
  if (place) d.地域 = place;
  if (area > 0) d.面積 = `${Math.round(area / T1_TSUBO)}坪（${Math.round(area)}㎡）`;
  const z = (raw && raw.zone) || {}, p = (raw && raw.point) || {};
  if (z.name && !z.none) d.用途地域 = z.name;
  const far = t1Num(z.far);
  if (far) { d.容積率 = far + "％"; if (area > 0) d.延べ床上限 = Math.round(area * far / 100) + "㎡"; }
  let two = false;
  const unit = t1Num(p.price);
  if (unit && !p.none && !p.error) {
    d.単価 = t1Unit(unit);
    if (p.change !== "" && p.change != null && !isNaN(+p.change)) d.変動 = (+p.change > 0 ? "＋" : +p.change < 0 ? "−" : "±") + Math.abs(+p.change) + "％";
    d.標準地の種類 = p.use || "";
    const roadM = +(String(p.road || "").match(/([\d.]+)m/) || [])[1] || 0;
    const a = t1Appraise(s, { roadM, corner:!!p.side });
    d.足し引き = a.it.length ? a.it.map(([k, r]) => `${k} ${r > 0 ? "+" : "−"}${Math.round(Math.abs(r) * 100)}％`).join("、") : "足し引きなし";
    if (area > 0) {
      const v1 = unit * area * (1 + a.rate), u2 = p.alt ? t1Num(p.alt.price) : 0;
      if (u2) { two = true; const [lo, hi] = [v1, u2 * area * (1 + a.rate)].sort((x, y) => x - y); d.目安額 = `約${t1Man(lo)}万〜${t1Man(hi)}万円`; }
      else d.目安額 = `約${t1Man(v1)}万円`;
    }
    // 目安の但し書き（rules の①〜④）
    const note = [];
    if (two) {
      const lowIsAlt = u2Low(p, unit);
      note.push(`低いほうは近くの${lowIsAlt ? p.alt.use : p.use}、高いほうは${lowIsAlt ? p.use : p.alt.use}の標準地の値です。`);
      if ((cat === "K1" || cat === "K2") && [p.use, p.alt.use].includes("住宅地")) note.push("家がある土地は、住宅地の値に近く見られやすい土地です。");
    } else if (p.mismatch) note.push(`近くに${p.mismatch.want}の標準地がなく、${p.mismatch.got}の値での計算なので、実際とは開きが出ます。`);
    const pfar = t1Num(p.far);
    if (!two && pfar && far && pfar !== far) note.push(`比べた標準地は容積率${pfar}％で、この土地の${far}％より${pfar > far ? "大きいので、実際はこれより低く出やすい" : "小さいので、実際はこれより高く出やすい"}です。`);
    if (p.d > 1000) note.push(`比べた標準地は${t1Km(p.d)}先です。`);
    if (note.length) d.目安の但し書き = note.join("");
  }
  const st = around && Array.isArray(around.stations) && around.stations[0];
  if (st) { d.駅 = st.name + "駅"; d.駅距離 = t1Km(st.d); }
  if (area > 0) d.台数 = Math.floor(area / 25);
  const mismatch = !two && !!(raw && raw.point && raw.point.mismatch);
  return { cat, tags, data:d, two, mismatch };
}
function u2Low(p, unit) { return t1Num(p.alt.price) < unit; }
