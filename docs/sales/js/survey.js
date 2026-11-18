// ---- ①〜③ 土地の様子（一枚の設問）と、ピンの後の左カラム（地図／写真／道から見る）----
// タイプ2（2_talk_main.html）とタイプ3（3_ai_main.html）の共通部品。画面の本体の <script> のあとに読む。
// 本体の部品（S・say・newRow・PATH・askAI・aiContext・goStep など）をそのまま使う。
// 設計：_works/2026-11-10_ClaudeAI_ピンの次の一手_設問と複数選択の設計企画書.md
//   見たものを見せる（左カラム）／聞くのは一度、まとめて（設問）／選ばれたものは、必ず答えに出る（AIの返事）
// 記録の番号は、これまでの③（q:3）を使う（③→④の返事・元に戻すの記録と同じ扱い）。画面の番号は「①〜③」。

const SURVEY = {
  lead: "値段より先に、この土地で何ができるかを決める条件があります。地図からは読めないので、この土地の様子を教えてください。",
  groups: [
    { g:"A", title:"道との関係", hint:"1つ", one:true, opts:["広い道に面している", "細い道に面している", "わからない"] },
    { g:"N", title:"どんな細さ", hint:"1つ", one:true, when:"細い道に面している", opts:["前の道が狭い（車がすれ違えない）", "細い通路の奥にある"] },
    { g:"W", title:"その通路の幅", hint:"1つ・わかれば", one:true, when:"細い通路の奥にある", opts:["2mある", "2mない・狭い", "測ったことがない"] },
    { g:"B", title:"当てはまるもの", hint:"いくつでも・なくてもよい", one:false, opts:["2つの道に面している（角）", "坂や段差がある・道路より高い（低い）", "細長い・形がいびつ", "車を置きにくい", "隣との境目がはっきりしない"] },
    { g:"C", title:"いまの使われ方", hint:"1つ", one:true, opts:["住んでいる家がある", "空き家・古い家がある", "何もない（更地）", "駐車場・畑など"] },
  ],
  // AIへ渡す事実（項目ごと）。AIに決まりを考えさせず、ここにある事実だけで話させる
  facts: {
    "広い道に面している": "建て直しの条件（幅4m以上の道に2m以上接する）は、接する長さの面では心配が少ない。あとは前の道の幅で、建てられる大きさが変わる。",
    "2つの道に面している（角）": "角地は使い勝手がよく、建ぺい率の緩和がある地域も多い（自治体の確認が必要）。",
    "細い道に面している": "道の細さは、建て直すときの条件と使える面積に効く。",
    "細い通路の奥にある": "旗竿地。通路が2m以上あれば建て直せる。2m未満なら再建築不可として見られ、値打ちは「お隣と合わせたら何ができるか」で決まる。",
    "わからない": "道への接し方は、担当が現地を一度見ればすぐ分かる。",
    "2mある": "通路が2m以上なら、旗竿地でも建て直せる。",
    "2mない・狭い": "通路が2m未満なら再建築不可として見られる。値打ちは「お隣と合わせたら何ができるか」で決まる。",
    "測ったことがない": "通路の幅はメジャー一本で分かり、担当が見に行くこともできる。",
    "前の道が狭い（車がすれ違えない）": "4m未満の道なら、建て直すとき敷地を道側へ下げる（セットバック）ため、使える面積が減る。前の道の幅は、建てられる床面積の上限にも効く。",
    "坂や段差がある・道路より高い（低い）": "造成や擁壁の費用が、売るときも建てるときも効く。古い擁壁は作り直しが必要な場合がある。",
    "細長い・形がいびつ": "建てられる建物の形が限られ、値段の見え方に効く。",
    "車を置きにくい": "駐車できるかどうかは、貸すときも売るときも、買い手・借り手の判断を大きく分ける。",
    "隣との境目がはっきりしない": "売る・分ける・建てるのどれでも、先に境界の確認（測量）が要ることが多い。",
    "住んでいる家がある": "建て直しは先の話でも、いつか渡すときに今日の条件がそのまま値打ちになる。",
    "空き家・古い家がある": "解体して売るか、そのまま貸すかの分かれ目は、建て直せるかどうか。",
    "何もない（更地）": "この条件がそのまま、この土地で何ができるかになる。",
    "駐車場・畑など": "今の使い方を続けるか変えるかで、確かめる決まり（農地なら転用の手続きなど）が変わる。",
  },
};
const UNSURE = new Set(["わからない", "測ったことがない", "隣との境目がはっきりしない"]); // 「現地で確かめる価値がある」と返す項目

function firstJudgment() {
  saveSession();
  say(SURVEY.lead, "渡したもの：値段より先に決まる条件がある、ということ", "開けた穴：地図では読めない土地の様子（持ち主なら見れば分かる）を、一枚でまとめて");
  surveyRow();
}
function surveyPicked(d) {
  const g = k => [...d.querySelectorAll(`.sgroup[data-g="${k}"] button.sel, .sgroup[data-g="${k}"] button.chosen`)].map(b => b.dataset.c);
  return { A:g("A")[0] || "", N:g("N")[0] || "", W:g("W")[0] || "", B:g("B"), C:g("C")[0] || "" };
}
const surveyItems = s => [s.N ? "" : s.A, s.N, s.W, ...s.B, s.C].filter(Boolean); // 細さを選んだら「細い道に面している」は重ねない
function surveyRow() {
  const d = newRow(3); d.classList.add("survey");
  d.querySelector(".qnum").textContent = "②"; // ②＝2往復目（①は土地評価データー）
  for (const gr of SURVEY.groups) {
    const box = document.createElement("div"); box.className = "sgroup"; box.dataset.g = gr.g; if (gr.when) box.hidden = true;
    box.innerHTML = `<div class="sg-title">${gr.title}<span class="hint">（${gr.hint}）</span></div>`;
    gr.opts.forEach((c, i) => {
      const b = document.createElement("button"); b.dataset.c = c; b.dataset.opt = i + 1; b.textContent = c;
      b.onclick = () => {
        if (d.dataset.step) { // 送った後は、最後に答えた行なら開き直す（選んでいたものは残し、押したボタンだけ選び直す）
          const was = [...d.querySelectorAll("button.chosen")].filter(x => (gr.one ? x !== b : true) && x.dataset.c !== "送信") // いくつでもの欄で選んでいた項目を押したら、外す;
          if (d.classList.contains("retry") && reopen(d)) { was.forEach(x => x.classList.add("sel")); sync(); b.click(); }
          return;
        }
        const on = !b.classList.contains("sel");
        if (gr.one) box.querySelectorAll("button.sel").forEach(x => x.classList.remove("sel"));
        b.classList.toggle("sel", on);
        sync();
      };
      box.appendChild(b);
    });
    d.appendChild(box);
  }
  d.insertAdjacentHTML("beforeend", `<div class="textline"><textarea class="other" rows="1" placeholder="ほかに伝えたいことがあれば書いてください（なくても送れます）"></textarea><button data-c="送信">送信</button></div>`);
  const send = d.querySelector('button[data-c="送信"]'), inp = d.querySelector(".other");
  function sync() {
    const sub = (k, on) => { const el = d.querySelector(`.sgroup[data-g="${k}"]`); el.hidden = !on; if (!on) el.querySelectorAll("button.sel").forEach(x => x.classList.remove("sel")); };
    sub("N", surveyPicked(d).A === "細い道に面している"); // 細い道 → どんな細さ → 通路の奥なら幅
    sub("W", surveyPicked(d).N === "細い通路の奥にある");
    const s = surveyPicked(d);
    lamp(send, !d.dataset.step && ((s.A && s.C) || !!inp.value.trim())); // 道との関係と使われ方がそろうか、書いた言葉があれば送れる
  }
  inp.addEventListener("input", sync); sync();
  send.onclick = () => {
    if (d.dataset.step) return;
    const s = surveyPicked(d), t = inp.value.trim();
    if (!((s.A && s.C) || t)) return;
    d._snap = beforeAnswer(); document.querySelectorAll("#talk .row.retry").forEach(x => x.classList.remove("retry"));
    if (!REPLAYING) d.classList.add("retry");
    d.querySelectorAll("button.sel").forEach(b => { b.classList.remove("sel"); b.classList.add("chosen"); });
    const items = surveyItems(s), press = items.join("／");
    d.dataset.step = PATH.length; PATH.push({ press, q:3, ...(t ? { type:t } : {}) }); renderRoute();
    ev("choice", { q:3, press, opt:0, typed:!!t });
    d.classList.add("done");
    me((press || "（選ばずに書いた）") + (t ? "\n" + t : ""));
    onSurvey(s, t);
  };
  document.getElementById("talk").appendChild(d);
}
// 答えをデータシートに「お答えより」の印付きで書く（確定事項。以降のAIは推測で上書きしない）
function applySurvey(s, t) {
  const sh = S.sheet, Y = "（お答えより）";
  sh.接道 = sh.形と向き = sh.高低差 = sh.車 = sh.境界 = null;
  if (s.A === "広い道に面している") sh.接道 = "広い道に面している" + Y;
  else if (s.N === "前の道が狭い（車がすれ違えない）") sh.接道 = "前の道は4m未満の可能性" + Y;
  else if (s.N === "細い通路の奥にある") {
    sh.形と向き = "奥まっている（旗竿地）" + Y;
    sh.接道 = s.W === "2mある" ? "旗竿地・通路2m以上" + Y : s.W === "2mない・狭い" ? "旗竿地・通路2m未満" + Y + "＝再建築不可の可能性" : "旗竿地" + Y + "・通路の幅は未確認";
    if (s.W !== "2mある" && s.W !== "2mない・狭い") S.signals.push("通路の幅：未確認（現地確認）");
  } else if (s.A === "細い道に面している") sh.接道 = "細い道に面している" + Y + "・細さは未確認";
  else if (s.A === "わからない") { sh.接道 = "未確認"; S.signals.push("接し方：客は分からない（現地確認）"); }
  else sh.接道 = "（選ばずに書いて答えた）";
  if (s.B.includes("2つの道に面している（角）")) sh.接道 += "／角地・2つの道に面している" + Y;
  if (s.B.includes("坂や段差がある・道路より高い（低い）")) sh.高低差 = "あり" + Y;
  if (s.B.includes("細長い・形がいびつ")) sh.形と向き = (sh.形と向き ? sh.形と向き + "・" : "") + "細長い・不整形" + Y;
  if (s.B.includes("車を置きにくい")) sh.車 = "置きにくい" + Y;
  if (s.B.includes("隣との境目がはっきりしない")) { sh.境界 = "未確定" + Y; S.signals.push("境界：測量の確認"); }
  sh.持ち主の意向 = s.C ? s.C + Y : "（選ばずに書いて答えた）";
  if (t) sh.事情 = (sh.事情 ? sh.事情 + " / " : "") + esc(t);
  renderData();
}
// 設問の直後の返事：選ばれた項目に必ず触れる。AIを呼べないとき・元に戻すとき・AIなしのときは、事実をつないだ台本
function surveyFallback(s) {
  const items = surveyItems(s).filter(x => !(x === "細い通路の奥にある" && /^2m/.test(s.W))), sure = items.filter(x => !UNSURE.has(x)).slice(0, 2), unsure = items.some(x => UNSURE.has(x));
  return sure.map(x => SURVEY.facts[x]).join("<br>") + (unsure ? "<br>分からない所は、そこを現地で確かめる価値があります。" : "");
}
function onSurvey(s, t) {
  applySurvey(s, t);
  BRANCH = null;
  inquiryBar(); // 問い合わせのボタンは④から出す
  const items = surveyItems(s);
  const userText = "設問への答え：" + (items.length ? "\n・" + items.join("\n・") : "（選ばずに書いた）") + (t ? "\n書いた言葉：" + t : "");
  if (REPLAYING || AI_OFF) { // 元に戻すときは、記録にある本物の返事を使う
    const rp = RESTORE && RESTORE.replies[0] && RESTORE.replies[0].q === 3 ? RESTORE.replies.shift() : null;
    if (rp) {
      AI_HIST.push({ role:"user", content:userText }, { role:"assistant", content:takeBranch(rp.reply).text });
      (S.api = S.api || []).push({ step:0, usage:rp.usage, costUsd:rp.costUsd, ms:rp.ms });
      return goStep(0, esc(takeBranch(rp.reply).text).replace(/\n/g, "<br>"), true);
    }
    return goStep(0, surveyFallback(s));
  }
  const ctx = aiContext(0) + "\n\n【この返事の決まり】利用者は、土地の様子を設問でまとめて答えました。"
    + "\n- 選ばれた項目には、すべて触れてください。触れ方は、下の「項目ごとの事実」の範囲で、この土地にとって何を意味するかを短く。影響の大きいものから順に。"
    + "\n- 項目を並べて読み上げるのではなく、話として一続きにします（全体で200字程度まで）。"
    + "\n- 利用者が「わからない」「測ったことがない」「隣との境目がはっきりしない」を選んだ項目に限り、不安材料にせず、「そこは現地で確かめる価値があります」と、確かめる理由として一言にします。"
    + "\n- まだ分かっていない点が、利用者に答えられそうなことなら、最後の問いで聞きます（現地へ回しません）。"
    + "\n- 項目ごとの事実と【周り】にない数字や決まりを足しません。書いた言葉があれば、先にそれに短く答えます。"
    + "\n- 最後は、上の指示どおりの問いで終えます。"
    + "\n\n【項目ごとの事実】\n" + items.map(x => "・" + x + "：" + SURVEY.facts[x]).join("\n");
  askAI(0, false, userText, { q:3, press:items.join("／"), typed:!!t, branch:"", branchBy:"", place:PLACE, near:S.near.name, road:S.sheet.接道 || "", intent:S.sheet.持ち主の意向 || "", kind:"設問に答える" }, ctx)
    .then(r => goStep(0, r ? r : surveyFallback(s) + AI_FAIL, !!r));
}

// ---- 左カラム：ピンを置いたら「この土地として何を見ているか」を見せる（地図／写真／道から見る）----
// 写真＝国土地理院の全国最新写真（無料・キー不要）。道から見る＝Google のストリートビュー（Maps Embed API。無料・キーはサイトを限定）
const LandView = (() => {
  const box = document.getElementById("map");
  let base = null; map.eachLayer(l => { if (l instanceof L.TileLayer) base = l; });
  const photo = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    { attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（写真）</a>', maxZoom:18 });
  const sv = document.createElement("div"); sv.className = "svbox"; sv.hidden = true;
  sv.innerHTML = '<iframe title="道から見た様子" loading="lazy" allow="accelerometer; gyroscope; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><div class="svnote">ピンの近くの道から見た様子です。ピンの方向を向いて開きます（左下の地図：青＝ピン、オレンジ＝見ている場所）。ドラッグで向きを変えられます。ピンの位置を直すときは「地図」へ。</div><div class="svmini" title="ピンの場所"></div>';
  box.appendChild(sv); L.DomEvent.disableClickPropagation(sv); L.DomEvent.disableScrollPropagation(sv);
  const frame = sv.querySelector("iframe");
  let key = "", mode = "map", svAt = "", mini = null, miniPin = null;
  async function svOpen(ll, at) { // 撮影地点が分かれば、そこからピンの方向へ向けて開く（分からなければ今まで通りピンの近くを向きなしで）
    const base = `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&fov=90&language=ja&region=JP`;
    let src = base + `&location=${at}`;
    try {
      const m = await fetch(`../../api/svmeta?lat=${ll.lat}&lng=${ll.lng}`).then(r => r.json());
      if (m && m.pano) {
        const r = Math.PI / 180, y = Math.sin((ll.lng - m.lng) * r) * Math.cos(ll.lat * r), x = Math.cos(m.lat * r) * Math.sin(ll.lat * r) - Math.sin(m.lat * r) * Math.cos(ll.lat * r) * Math.cos((ll.lng - m.lng) * r);
        const hd = ((Math.atan2(y, x) / r) + 360) % 360;
        src = base + `&pano=${encodeURIComponent(m.pano)}&heading=${hd.toFixed(0)}&pitch=0`;
        if (miniCam) miniCam.setLatLng([m.lat, m.lng]); else if (mini) miniCam = L.circleMarker([m.lat, m.lng], { radius:5, color:"#fff", weight:2, fillColor:"#e8710a", fillOpacity:1 }).addTo(mini);
        camAt = [m.lat, m.lng];
      }
    } catch (e) { /* 向きなしで開く */ }
    if (svAt === at) frame.src = src;
  }
  let miniCam = null, camAt = null;
  function miniShow(ll) { // 道から見る景色にはピンを描けないので、隅の小さな地図でピンの場所を示す
    if (!mini) {
      mini = L.map(sv.querySelector(".svmini"), { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, touchZoom:false });
      L.tileLayer(base ? base._url : "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { maxZoom:18 }).addTo(mini);
      miniPin = L.marker(ll).addTo(mini);
    }
    mini.invalidateSize(); mini.setView(ll, 16); miniPin.setLatLng(ll);
    if (camAt && !miniCam) miniCam = L.circleMarker(camAt, { radius:5, color:"#fff", weight:2, fillColor:"#e8710a", fillOpacity:1 }).addTo(mini); // オレンジの点＝見ている場所
  }
  const bar = L.control({ position:"topright" });
  bar.onAdd = () => {
    const el = L.DomUtil.create("div", "viewbar");
    el.innerHTML = '<button data-v="map">地図</button><button data-v="photo">写真</button><button data-v="sv" hidden>道から見る</button>';
    L.DomEvent.disableClickPropagation(el);
    el.addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.classList.contains("off")) show(b.dataset.v); });
    return el;
  };
  bar.addTo(map);
  const btn = v => bar.getContainer().querySelector(`[data-v="${v}"]`);
  fetch("../../api/mapkey").then(r => r.ok ? r.json() : null).then(j => { key = (j && j.key) || ""; refresh(); }).catch(() => {});
  function refresh() {
    const s = btn("sv"); s.hidden = !key; lamp(s, !!here);
    bar.getContainer().querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
    if (mode === "sv" && here) {
      const at = here.lat.toFixed(6) + "," + here.lng.toFixed(6);
      if (at !== svAt) { svAt = at; svOpen(here, at); }
      miniShow(here);
    }
  }
  function show(v) {
    if (v === "sv" && !(key && here)) return;
    mode = v;
    if (v === "photo") { if (base) map.removeLayer(base); photo.addTo(map); }
    else if (v === "map") { map.removeLayer(photo); if (base && !map.hasLayer(base)) base.addTo(map); }
    sv.hidden = v !== "sv"; box.classList.toggle("sv-on", v === "sv"); // 道から見ている間は、地図の部品（拡大・出典）を隠す
    refresh();
    if (typeof ev === "function" && !REPLAYING) ev("view", { v });
  }
  return { show, refresh, ready:() => !!key };
})();
map.on("click", () => setTimeout(LandView.refresh, 0)); // ピンを置いたら「道から見る」を点灯（道から見ている間にピンを直したら、その場所に付け替える）
// 評価したら、道から見る（キーがなければ写真）に切り替える。地図は役目を終えている
document.getElementById("go").addEventListener("click", () => {
  if (REPLAYING || !S || !here || EVAL_AT !== goKey()) return;
  LandView.show(LandView.ready() ? "sv" : "photo");
});
// 締めの向き（11-16 総合チェック4-2）：言い切った見立てを一つ挙げ、合っているかを担当が確かめる。設問で「わからない」等があった土地だけ、その点を名指しして現地で確かめる
function closeAim(who) {
  const unsure = (S.signals || []).some(x => /現地確認|測量の確認/.test(x));
  return unsure
    ? `設問で利用者が分からなかった点を一つ名指しして、そこは${who}が現地で確かめる、と引き受けます。`
    : `ここまでの話でAIが言い切った見立てを一つ挙げ（例：国の標準地の値で単純に計算すると約◯万円）、それが実際に合っているかは${who}の担当が確かめる、と引き受けます。`;
}
// AIへ渡す公開データの扱い（両タイプ共通。11-16 総合チェック4-1）
const AI_LAND = { pub:"\n【公開データ】用途地域・建ぺい率・容積率は、この土地（ピンの場所）の国の公開データです。標準地の値（価格・前の道など）は近くの別の土地のもので、この土地の値段ではありません。値段を聞かれたら、「単純計算の目安」を「国の標準地の値で単純に計算すると約◯万円」の形で、出どころを付けて言います。その値で売れるとは約束せず、値が動く点を一つ挙げて、そこは担当が確かめる、とつなげます。「単純計算の目安」に、標準地の種類がこの土地と違うと書かれていれば、数字と一緒にそのことを一度言います。目安が二つ書かれていれば、二つとも出どころを付けて言い、この土地がどちらに近そうかを、設問の答え（今の使われ方・道）から一言添えます（例：住んでいる家がある土地なら「住宅地の値に近く見られやすい」）。広さの話は「この土地の面積」の値だけを使い、標準地の広さをこの土地の広さとして話さないでください。", none:"\n【公開データなし】この場所の標準地価格・用途地域のデータは用意していません。数字は作りません。聞かれたら「国のデータがこの場所にはありません」と一度だけ言い、利用者の答えと周りの様子から言える見立てを一つ返します。" };

// 管理画面の設定（店の設定・HPの読み取り）も記録に入れ、再表示で戻す（11-17 ユーザー：再表示はメイン画面・管理画面・利用状況の全部）
const SET_KEYS = ["reAdmin", "reTalk", "reType1", "reShopKnow", "reShopHP"];
buildState = (f => () => { const o = {}; SET_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v != null) o[k] = v; }); return { ...f(), settings:o }; })(buildState);
restoreSession = (f => d => {
  const set = d && d.state && d.state.settings;
  if (set && !d.applied) { // 設定が今と違えば書き戻して読み直す（開いている管理画面は reRestoreStamp で読み直す）
    let changed = false;
    SET_KEYS.forEach(k => { const cur = localStorage.getItem(k), v = set[k] ?? null; if (v !== cur) { changed = true; if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } });
    localStorage.setItem("reRestoreStamp", String(Date.now()));
    if (changed) { sessionStorage.setItem("rePendingRestore", JSON.stringify(d)); setTimeout(() => location.reload(), 50); return; }
  }
  return f(d);
})(restoreSession);
try { const p = sessionStorage.getItem("rePendingRestore"); if (p) { sessionStorage.removeItem("rePendingRestore"); setTimeout(() => { try { restoreSession({ ...JSON.parse(p), applied:true }); } catch (e) { REPLAYING = false; } }, 800); } } catch (e) { /* 戻せなくても画面は使える */ }
