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
    "広い道に面している": "建て直しの条件（幅4m以上の道に2m以上接する）は、接する長さの面では心配が少ない。残るのは前の道の幅。",
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
  d.querySelector(".qnum").textContent = "①〜③";
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
    + "\n- 「わからない」「未確認」「はっきりしない」項目は不安材料にせず、「そこは現地で確かめる価値があります」と、確かめる理由として一言にします。"
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
  sv.innerHTML = '<iframe title="道から見た様子" loading="lazy" allow="accelerometer; gyroscope; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><div class="svnote">ピンの近くの道から見た様子です。ドラッグで向きを変えられます。ピンの位置を直すときは「地図」へ。</div>';
  box.appendChild(sv); L.DomEvent.disableClickPropagation(sv); L.DomEvent.disableScrollPropagation(sv);
  const frame = sv.querySelector("iframe");
  let key = "", mode = "map", svAt = "";
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
  fetch("../api/mapkey").then(r => r.ok ? r.json() : null).then(j => { key = (j && j.key) || ""; refresh(); }).catch(() => {});
  function refresh() {
    const s = btn("sv"); s.hidden = !key; lamp(s, !!here);
    bar.getContainer().querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
    if (mode === "sv" && here) {
      const at = here.lat.toFixed(6) + "," + here.lng.toFixed(6);
      if (at !== svAt) { svAt = at; frame.src = `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${at}&fov=90&language=ja&region=JP`; }
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
