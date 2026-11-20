// ---- タイプ1（選択式・AIなし）の組み立て：メイン画面と管理画面の共通部品 ----
// 決まりは _works/2026-11-16_ClaudeAI_タイプ1初期設定/tryout.py の compose・fill・reply をそのまま移したもの。
// アプリの一式は data/type1_defaults.json（読むだけ）。店の設定（重視する業務内容・受けの差分）は localStorage「reType1」。
// 当てはめ案：_works/2026-11-16_ClaudeCode_タイプ1の当てはめ案.md
let T1D = null, T1C = null, T1P = null, T1Q = null; // アプリの一式／③の当て方の規則／道の表（type1_paths.csv）／選択肢の候補の表（type1_choices.csv）
// 道の表：1行＝1つの道（大分類・小分類・手がかりの言葉・一般語・④・⑤・土地の種類・業態）。木は持たず、行の絞り込みで③④⑤を組む
function t1Csv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(Boolean));
  const h = head.map(x => x.replace(/^\ufeff/, "").trim());
  return { head:h, rows:body.map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] || "").trim()]))) };
}
async function t1Load() {
  if (!T1D) {
    const [d, c, p, q] = await Promise.all(["data/type1_defaults.json", "data/type1_categories.json", "data/type1_paths.csv", "data/type1_choices.csv"].map(u => fetch(u, { cache:"no-cache" }).then(r => u.endsWith(".csv") ? r.text() : r.json())));
    T1D = d; T1C = c; T1P = t1Csv(p); T1Q = t1Csv(q);
    const bizOf = Object.fromEntries(Object.entries(T1D.businesses).map(([b, x]) => [x.sub, b]));
    const optOf = Object.fromEntries(Object.entries(T1D.options).map(([id, o]) => [o.label, id]));
    T1P.small = {}; // 小分類ごと：手がかりの言葉・一般語・業態（表の上にあるものほど先に当てる）
    for (const r of T1P.rows) { r.opt = optOf[r["④"]] || null; if (!T1P.small[r.小分類]) T1P.small[r.小分類] = { big:r.大分類, words:r.手がかりの言葉, generic:!!r.一般語, biz:bizOf[r.業態] || "b3" }; }
  }
  return T1D;
}
// 次の選択肢：小分類（cats）と、通ってきた言葉（③のボタン・④の選択…）から、候補の表の行を選ぶ。言語エンジンのように、文脈で次が入れ替わる
// 同じ小分類の行は重みの順。「前の言葉」のある行は、文脈に当たったときだけ出して一つ上げる。別の小分類の行も、前の言葉が当たれば一つ下げて混ぜる。選んだものは出さない
function t1Next(cats, ctx, chosen, n, shown) { // shown：前の段で見せて選ばれなかったもの（一つ下げる。次の段に新しいものが上がるように）
  const text = [].concat(ctx).join(" "), out = [];
  const closed = cats.length && cats.every(c => (T1C.closed || []).includes(c)); // 土地の話に混ぜない小分類（借りる・リフォーム）は、ほかの小分類の行を混ぜない
  for (const r of T1Q.rows) {
    if (!r.選択肢 || (chosen || []).includes(r.選択肢)) continue;
    const neg = /^!/.test(r.前の言葉 || ""); if (neg && new RegExp(r.前の言葉.slice(1)).test(text)) continue; // 「!言葉」＝その言葉の後には出さない（分譲地を買う客に「まとめて売る」：ユーザー 11-18）
    const mine = r.小分類.split("|").some(c => cats.includes(c)), cond = neg ? "" : r.前の言葉, hit = cond && new RegExp(cond).test(text);
    if (cond && !hit) continue;
    if (!mine && (!hit || closed)) continue;
    const score = (+r.重み || 1) + (mine ? (hit ? 1 : 0) : -1) - (!hit && (shown || []).includes(r.選択肢) ? 2 : 0);
    out.push({ label:r.選択肢, score, why:mine ? (hit ? "小分類＋前の言葉「" + text.match(new RegExp(cond))[0] + "」" : "小分類") : "前の言葉「" + text.match(new RegExp(cond))[0] + "」（ほかの小分類から）", row:r, hit:!!hit });
  }
  const seen = new Set();
  let list = out.sort((a, b) => b.score - a.score).filter(x => !seen.has(x.label) && seen.add(x.label));
  const fresh = list.filter(x => x.hit || !(shown || []).includes(x.label)); // 前の言葉に当たった行は、同じ名前でも新しい候補
  if (shown) list = fresh; // ⑤では④で見せたものを繰り返さない（前の言葉に当たったものは別。リフォームの④⑤が同じ並びになった：ユーザー 11-18）。残りが少なければ少ないまま
  return list.slice(0, n || 5);
}
// HPの見出しを小分類に当てる。ボタン名は見出しのまま、内部は cats（小分類の名前）。同じ小分類は短い見出し一つに、大枠は規則の小分類を合わせる
function t1Classify(labels) {
  const re = s => new RegExp(s, "i"), drop = re(T1C.drop), out = re(T1C.outside), keys = Object.keys(T1P.small);
  const by = new Map();
  for (const raw of labels) {
    const label = String(raw && raw.label != null ? raw.label : raw).replace(/^[・\s]+/, "").replace(/\s*\(\d+\)$/, "").trim().replace(/^(.+?)\s+\1$/, "$1"); // 「売却査定 売却査定」は一つに
    if (!label || drop.test(label) || (out.test(label) && !/不動産|建築|住宅|土地|建物|物件/.test(label))) continue; // 「建築工事及び土木工事の…施工」は外さない
    const hit = s => keys.filter(k => T1P.small[k].words && re(T1P.small[k].words).test(s));
    const head = !/売却|査定|買取/.test(label) && (label.match(/^(.{2,8}?)の/) || [])[1]; // 「マンションの売却」は売る側（11-18） // 「賃貸物件の仲介・管理・リフォーム」は頭の「賃貸物件」で決める（売買物件の…と④を分けるため）
    let cats = head && hit(head).length ? hit(head) : hit(label);
    if (/物件$|物件特集$/.test(label) && !/^(売買|賃貸|自社|売主)/.test(label)) cats = cats.filter(k => T1C.rentSide.includes(k)).length ? cats.filter(k => T1C.rentSide.includes(k)) : ["購入・物件探し"]; // 「駐車場有り物件」「新築・築浅物件」は物件の絞り込み（買う・借りる側）
    const rentMark = /貸|賃貸|借|テナント|月極|駐車場|部屋|入居|単身|ファミリー/.test(label);
    if (cats.includes("店舗・事務所・駐車場を借りたい") && /事業用|店舗|事務所|倉庫|工場|駐車場|貸土地|貸地/.test(label)) cats = cats.filter(k => k !== "借りたい・部屋探し"); // 「事業用賃貸物件」は事業用だけ
    if (cats.includes("賃貸・管理")) cats = cats.filter(k => k !== "購入・物件探し"); // 「別荘・敷地管理」は管理
    if (cats.length > 1 && !rentMark || /経営|運用|活用/.test(label) || /売/.test(label) && !/貸|賃貸/.test(label) || /物件/.test(label) && !rentMark) { const o = cats.filter(k => !T1C.rentSide.includes(k)); cats = o.length ? o : /経営|運用|保有|活用/.test(label) ? ["賃貸・管理"] : /売|物件/.test(label) ? ["購入・物件探し"] : cats; } // 借りる側は、貸す・借りるの印がある見出しだけ（「事業用売買物件」「店舗改装」「駐車場経営」は借りる側でない）
    if (cats.some(k => T1C.rentSide.includes(k)) && !/売|投資|収益|購入/.test(label)) cats = cats.filter(k => !["購入・物件探し", "収益物件・アパート", "売却（仲介）"].includes(k)); // 賃貸の見出しは借りる側だけ
    const sp = cats.filter(k => !T1P.small[k].generic);
    cats = (sp.length ? sp : cats.slice(-1)).slice(0, 3); // 一般語（売却など）は、具体的な小分類があれば外す。一般語だけなら表の下のもの（売却査定＝査定・相場）
    if (!cats.length) continue; // 大枠の見出し（事業内容など）からは足さない。中身はそのページの一覧から拾う
    let sideAsk = null; // 借りる側と貸す側（管理）の両方に当たる見出しは、片方に寄せて店に向きを確かめてもらう（④を混ぜない。管理のあるものは貸す側、ほかは借りる側）
    if (cats.some(k => T1C.rentSide.includes(k)) && cats.includes("賃貸・管理")) { const lend = /管理/.test(label), b = cats.filter(k => T1C.rentSide.includes(k)), l = cats.filter(k => !T1C.rentSide.includes(k)); sideAsk = lend ? b : l; cats = lend ? l : b; } // 「管理」のある見出しは貸す側（オーナー向け）に寄せる（入居者募集の視点。ユーザー 11-18）
    if (!sideAsk && cats.some(k => T1C.rentSide.includes(k)) && /賃貸(仲介|事業|業)|売買・賃貸|賃貸・売買/.test(label) && !/部屋|借|住まい探し/.test(label)) sideAsk = ["賃貸・管理"]; // 「不動産売買・賃貸仲介」「不動産賃貸事業」は貸す側にも読める。借りる側に寄せて店に確かめてもらう（11-18）
    const broad = !(head && hit(head).length) && hit(label).length >= 3; // 「不動産の賃貸・売買・仲介・管理」のような何でもの見出しは、はっきりしたリンクに譲る
    const key = cats.join("+"), had = by.get(key), weak = broad ? 1.5 : raw && raw.weak != null && raw.weak !== false ? +raw.weak : (/物件$|物件特集$/.test(label) && !/^(売買|賃貸|自社|売主)/.test(label)) ? 2 : 1;
    if (!had || weak < had.weak || weak === had.weak && label.length < had.label.length) by.set(key, { label, cats, weak, sideAsk, prose:!!(raw && raw.prose), biz:T1P.small[cats[0]].biz, at:had ? had.at : by.size });
  }
  const one = new Set([...by.values()].filter(n => n.cats.length === 1).map(n => n.cats[0]));
  return [...by.values()].filter(n => n.cats.length === 1 || !n.cats.every(c => one.has(c))) // 合わせ物は、中身が全部単独で出ていれば外す
    .sort((a, b) => a.at - b.at).map(({ at, weak, ...n }) => n);
}
// ---- 店が組む選択の木（③から先）。保存は localStorage「reType1」（v:3。前の版の保存は読まない） ----
// 節：{ label, cats?（③：小分類）, gen?（④⑤：候補の表から出したもの。4 か 5）, text?（選んだ客に返す文。店が書く）, ask?（次の問い）,
//       kids?（ない＝初期値のまま＝候補の表から文脈で出す。[]＝子なし＝問い合わせだけ） }
// trail＝③からその節までの並び（文脈）。④⑤は小分類と trail の言葉で決まる（言語エンジンのように）。土地では変わらない
const T1_ASK3 = "この中で、先に知りたいのはどれですか。";
const T1_ASK0 = "道の関係で、評価には現地の確認が大切です。いちばん近いご相談を選んでください。"; // ③の前の一言（ユーザー 11-17）
const T1_ASK0_RENT = "賃貸に関するお問い合わせでしょうか？いちばん近いご相談を選んでください。"; // ③に賃貸（貸す・借りる）があるとき
const T1_ASK0_NONE = "この先のご相談は、担当が直接うかがいます。下のボタンから、ここまでの内容を添えてお問い合わせください。"; // ③が0件のとき（問い合わせだけ）
const T1_ASK4 = "もう少し詳しく、どれが気になりますか。";
const T1_INQ = "ここまでの内容を添えて、メールで問い合わせる";
const T1_N = 5; // 一つの段に出す候補の数
const T1_BASE = [ // URLを入れる前の見本の③（HPを読んで0件の店には出さない＝問い合わせだけ。ユーザー 11-17：無理やりの相続・お金の話は一般の不動産屋には厄介）
  { label:"売りたい", cats:["売却（仲介）"] }, { label:"早く手放したい", cats:["早く売る・買取"] },
  { label:"土地を活かしたい", cats:["土地活用", "空き家・空き地"] }, { label:"相続した・相続する", cats:["相続"] },
];
const T1_OMAKASE = [{ label:"売りたい方", cats:["売却（仲介）"] }, { label:"買いたい方", cats:["購入・物件探し"] }, { label:"貸したい方", cats:["賃貸・管理"] }, { label:"借りたい方", cats:["借りたい・部屋探し"] }];
function t1Default(items, omakase) { // omakase＝「不動産のことなら何でも」型の店。③が3つに届かなければ、基本の取引から足す（相続・お金の話は足さない。ユーザー 11-18） // HPから拾った見出し（小分類に当てたもの）だけが③になる。足りなくても補わない（出口の問い合わせで受ける）
  const cl = items && items.length ? t1Classify(items.map(i => ({ label:i.label, prose:/:prose$/.test(i.from || ""), weak:/:prose$/.test(i.from || "") ? 3 : /^(title|desc)$/.test(i.from || "") ? 2 : /:text$/.test(i.from || "") ? 0 : null }))) : []; // 同じ分類なら、事業内容の一覧（本文）＞メニューのリンク＞物件の絞り込み・タイトル・説明文の言葉
  const rentOnly = (items || []).some(i => /賃貸|貸|借り|部屋/.test(i.label)) && !(items || []).some(i => /売|買|購入|分譲|新築|中古/.test(i.label)); // 賃貸だけの店（長崎第一不動産）：「〇〇市の物件」は借りる側
  if (rentOnly) for (const n of cl) if (n.cats.length === 1 && n.cats[0] === "購入・物件探し") n.cats = ["借りたい・部屋探し"];
  const top0 = cl.map(n => ({ label:n.label, cats:n.cats, ...(n.sideAsk ? { alt:n.sideAsk } : {}), ...(n.prose ? { prose:true } : {}) })); // prose＝HPの文章から拾った（店に確かめてもらう）
  for (const n of top0) if (n.alt) t1SetDir(n, "both"); // 貸す・借りるの両方に読める見出しは、最初から「両方」（ユーザー 11-20）
  const top = top0.slice();
  if (omakase) for (const b of T1_OMAKASE) { if (top.length >= 3) break; if (!top.some(n => n.cats.includes(b.cats[0]))) top.push({ ...b, cats:b.cats.slice(), fill:true }); }
  return { v:3, url:"", top:items === undefined ? T1_BASE.map(n => ({ ...n })) : top };
}
// 賃貸の向き：借りる方向け（部屋探し・事業用）／貸す方（オーナー）向け（賃貸・管理）。どちらでもなければ null
const T1_PARK = /駐車|パーキング|月極/;
function t1Side(cats, label) { cats = cats || []; return cats.some(c => T1C.rentSide.includes(c)) ? "borrow" : cats.includes("賃貸・管理") || cats.includes("土地活用") && T1_PARK.test(label || "") ? "lend" : null; } // 駐車場の見出しで土地活用＝貸す側
// ③の向きの3択：売買＝売りたい／買いたい／両方、賃貸＝貸したい／借りたい／両方（ユーザー 11-20）。x＝売る・貸す側、y＝買う・借りる側
const T1_DIRS = { sale:{ x:"売りたい", y:"買いたい" }, rent:{ x:"貸したい", y:"借りたい" } };
function t1Dir(n) { // 向きのない行は null
  if (!n || !n.cats) return null;
  if (n.pair) return { kind:n.pair.kind, dir:n.dir, x:n.pair.x, y:n.pair.y };
  const c = n.cats, s = t1Side(c, n.label), park = T1_PARK.test(n.label || "");
  const kind = s ? "rent" : c.includes("購入・物件探し") || c.includes("売却（仲介）") ? "sale" : null;
  if (!kind) return null;
  const dir = s ? (s === "borrow" ? "y" : "x") : c.includes("購入・物件探し") ? "y" : "x", other = dir === "x" ? "y" : "x";
  const def = kind === "rent" ? { x:[park ? "土地活用" : "賃貸・管理"], y:[park ? "駐車場を借りたい" : "借りたい・部屋探し"] } : { x:["売却（仲介）"], y:["購入・物件探し"] };
  return { kind, dir, [dir]:c.slice(), [other]:n.alt || def[other] }; // alt＝読み取りで反対側にも当たった小分類
}
// 向きを変える（店が管理画面で）。両方の側の小分類を pair に取っておく。その先の初期値は作り直す
function t1SetDir(n, dir) {
  const p = t1Dir(n); if (!p || p.dir === dir) return;
  n.pair = { kind:p.kind, x:p.x, y:p.y }; n.dir = dir;
  n.cats = dir === "both" ? [...new Set(p.x.concat(p.y))] : p[dir].slice();
  delete n.alt; delete n.sideAsk; delete n.kids;
}
// HPを読む：トップ＞物件情報＞会社概要・事業内容を、サーバーがいつも読む
async function t1ReadMenu(url, by) {
  return (await fetch("../../api/shopmenu", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ url, by }), signal:AbortSignal.timeout(60000) })).json();
}
function t1Shop() {
  const BOT = () => ({ v:3, url:new URL("../../sample/", location.href).href, top:[{ label:"売る", cats:["売却（仲介）"] }, { label:"買う", cats:["購入・物件探し"] }, { label:"相続", cats:["相続"] }, { label:"賃貸（貸したい方）", cats:["賃貸・管理"] }, { label:"賃貸（借りたい方）", cats:["借りたい・部屋探し"] }, { label:"買取", cats:["早く売る・買取"] }] }); // サンプルHPの業務案内
  if (window.RE_SITE_BOT) return BOT();
  try { const s = JSON.parse(localStorage.getItem("reType1")); if (s && s.v === 3 && Array.isArray(s.top)) return s; } catch (e) { /* 初期値 */ }
  if (window.RE_TRIAL) return BOT(); // お試し設定：まだ組んでいなければ、サンプルHPの状態から
  return t1Default();
}
// 子の一覧。trail は③からこの節まで（この節を含む）
function t1Kids(node, land, trail) {
  if (node.kids) return node.kids;
  const t = trail || [node], words = t.map(n => n.label);
  let cats = t[0].cats || [];
  if (t.length === 1) {
    const p = t1Dir(node);
    if (p && p.dir === "both") { // 両方：売る（貸す）側と買う（借りる）側の④を交互に。数は多くてよいが、同じ名前は一つだけ（ユーザー 11-20）
      const a = t1Next(p.x, words, [], T1_N), b = t1Next(p.y, words, [], T1_N), seen = new Set(), out = [];
      for (let k = 0; k < T1_N; k++) for (const [x, sc] of [[a[k], p.x], [b[k], p.y]]) if (x && !seen.has(x.label) && seen.add(x.label)) out.push({ label:x.label, gen:4, why:x.why, sc });
      return out;
    }
    return t1Next(cats, words, [], T1_N).map(x => ({ label:x.label, gen:4, why:x.why }));
  }
  if (node.sc) cats = node.sc; // 両方の④は、出てきた側の小分類で⑤を出す
  if (t.length === 2 && node.gen === 4) {
    if ((node.label === "地域重視" && cats.some(c => T1C.rentSide.includes(c))) || /どのあたり|地域から探/.test(node.label)) { // 「どのあたり」「地域から」は地域を出すしかない（ユーザー 11-18） // HPの物件の地区（学区・駅・郵便番号の町を混ぜて、物件の多い順）から3つ＋「その他の地域」
      const a = (t1Shop().areas || []).slice(0, 3);
      return (a.length ? a.concat("その他の地域") : []).map(x => ({ label:x, gen:5, area:true, kids:[] })); // 取れない店は⑤なし（問い合わせだけ）。表の「HP判定利用」は見本の1行
    }
    const shown = t1Next(cats, [t[0].label], [], T1_N).map(x => x.label);
    return t1Next(cats, words, words.slice(1), T1_N, shown).map(x => ({ label:x.label, gen:5, why:x.why, kids:[] }));
  }
  return [];
}
// 初期値のままの子を、今の一覧で固める（店が直すときだけ）
function t1Fix(node, land, trail) {
  if (!node.kids) node.kids = t1Kids(node, land, trail).map(({ why, ...n }) => n);
  return node.kids;
}
function t1Tpl(node) { // 店が書いた文があればそれ。なければ初期の文（③は小分類ごと、④⑤は候補の表の「返す文」）
  if (node.text != null) return node.text;
  if (node.cats && node.dir === "both" && node.pair) return node.pair.kind === "rent" ? "賃貸のご相談ですね。" : "売買のご相談ですね。";
  if (node.cats) return (T1C.reply3 || {})[node.cats[0]] || "";
  if (node.area) return node.label + "ですね、詳しいご要望はありますか？";
  const r = T1Q.rows.find(x => x.選択肢 === node.label); return r ? r.返す文 || "" : "";
}
function t1Text(node, land) { return t1Fill(t1Tpl(node), land); }
// 問いと締めは、③の小分類に専用の文があればそれ（借りる・リフォームは土地の見立てでないので。type1_categories.json の ask）
const t1AskSet = cats => { cats = cats || []; const r = cats.filter(c => T1C.rentSide.includes(c)).length; return r && r < cats.length ? {} : cats.map(c => (T1C.ask || {})[c]).find(Boolean) || {}; }; // 貸す・借りるの「両方」は共通の問い
function t1AskOf(node, depth, cats) { const a = t1AskSet(cats || node.cats); return node.ask != null ? node.ask : depth === 0 ? a.ask3 || T1_ASK3 : a.ask4 || T1_ASK4; }
function t1Close(cats) { return t1AskSet(cats).close || T1D.rules.close; }
const T1_HOLE = /\{([^}]+)\}/g;
// 穴に値を入れる。値のない穴を含む文は、その一文ごと落とす（「現地で確認」には差し替えない）
function t1Fill(text, land) {
  return (String(text || "").match(/[^。]+。?/g) || []).filter(s => [...s.matchAll(T1_HOLE)].every(m => land.data[m[1]] != null && land.data[m[1]] !== ""))
    .map(s => s.replace(T1_HOLE, (_, h) => String(land.data[h]))).join("");
}
// ④の顔ぶれ。biz は重視する業務内容（順番つき）
function t1Compose(land, biz, cats) { // cats（小分類）を渡すと、業態の代わりに道の表（type1_paths.csv）から作る
  const D = T1D, O = D.options, R = D.rules, ids = [], origin = {};
  if (cats) {
    for (const c of cats) for (const r of T1P.rows) if (r.小分類 === c && r.opt && r.土地の種類.split(/\s+/).includes(land.cat) && !(r.opt in origin)) { ids.push(r.opt); origin[r.opt] = T1P.small[c].biz; } // 道の表の上から、この土地の種類に合う④
  } else for (const b of biz) for (const i of (D.sets[b] || {})[land.cat] || []) if (!(i in origin)) { ids.push(i); origin[i] = b; } // 1番から埋め、重なりは一つに
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
