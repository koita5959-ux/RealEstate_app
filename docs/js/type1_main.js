// ---- タイプ1：設問のあとを、AIではなく選択肢で進める（js/type1.js の組み立てを使う） ----
// ③＝店の業務内容（管理画面で並べた順）→ 返事＋問い → ④ → ⑤ → 店が足した枠の分だけ先へ。子のない選択肢の先は問い合わせだけ。
// ④から先の段には、いつでも「ここまでの情報で問い合わせを送る」を付ける。書き欄は置かない（企画書8章）
let T1S = null, T1L = null, T1O = null;
onSurvey = (f => (s, t) => { T1S = s; return f(s, t); })(onSurvey);
fillLand = (f => (sh, r, area) => { S.landRaw = r; return f(sh, r, area); })(fillLand);
const t1Place = () => { const a = String(ADDR || ""), c = String(PLACE || ""); const town = a.replace(/^.*?[都道府県]/, "").replace(/^.*?[市区町村]/, "").replace(/[0-9０-９丁目番地\-−ー].*$/, ""); return town || c.replace(/^.*?[都道府県]/, ""); };
function t1Btn(label, sub, cls) {
  const b = document.createElement("button"); b.className = "t1b" + (cls ? " " + cls : "");
  b.innerHTML = `<span class="t1l">${esc(label)}</span>` + (sub ? `<span class="t1s">${esc(sub)}</span>` : "");
  return b;
}
function t1Mail(where, kind) { // kind：mail＝途中で問い合わせ／final＝選択肢の尽きた先
  ev("t1_exit", { kind, at:where });
  S.sheet.選んだ出口 = kind === "mail" ? "ここまでの情報で問い合わせ（" + where + "）" : "最後から問い合わせ（" + where + "）";
  inquiryBar(); const b = document.getElementById("inqOpen"); if (b) b.click();
}
function t1Done(row, b) { row.classList.add("done"); row.querySelectorAll("button").forEach(x => { x.disabled = true; if (x !== b) x.classList.add("t1off"); }); b.classList.add("chosen"); }
async function goStep(i, lead) {
  if (i !== 0) return;
  say(lead);
  await t1Load();
  T1O = t1Shop();
  T1L = landOf(T1S, S.sheet, S.landRaw, S.around, S.area, t1Place());
  S.sheet.タイプ1の分け = `${T1D.categories[T1L.cat]}／条件札：${T1L.tags.map(t => T1D.tags[t]).join("・") || "なし"}`;
  step(T1O.top, 4, null);
  inquiryBar();
  saveSession();
  function inq(row, q, kind) {
    const b = t1Btn(T1_INQ, "ピンの場所・土地の様子・選んだ道を添えます", kind === "final" ? "final" : "mail");
    b.onclick = () => { t1Done(row, b); t1Mail(NUM[q - 1], kind); }; row.appendChild(b);
  }
  function step(list, q, biz) { // q は記録の番号（表示は q−1：4＝③）
    const row = newRow(q); row.classList.add("t1row");
    list.forEach((n, k) => {
      const b = t1Btn(n.label, n.grey ? `${n.grey.reason} →「${T1D.options[n.grey.goto].label}」を見る` : n.opt ? t1Sub(T1L, n.opt) : "", n.grey ? "grey" : n.first ? "first" : "");
      if (n.first && !n.grey) b.insertAdjacentHTML("afterbegin", `<span class="t1m">${esc(T1D.rules.firstMarkLabel)}（${esc(n.first)}）</span>`);
      b.dataset.opt = n.opt || "";
      b.onclick = () => n.grey ? row.querySelector(`button[data-opt="${n.grey.goto}"]`)?.click() : pick(n, k, b);
      row.appendChild(b);
    });
    if (q > 4 || !list.length) inq(row, q, list.length ? "mail" : "final");
    document.getElementById("talk").appendChild(row);
    function pick(n, k, b) {
      t1Done(row, b);
      PATH.push({ press:n.label, q, opt:k + 1 }); renderRoute();
      ev("choice", { q, press:n.label, id:n.opt || (n.nx && n.nx.id) || null, biz:n.biz || biz });
      if (q === 4) S.sheet.相談目的 = esc(n.label);
      me(n.label);
      const bz = n.biz || biz, kids = t1Kids(n, T1L), text = t1Text(n, T1L, bz);
      if (kids.length) { say([text, t1AskOf(n)].filter(Boolean).map(esc).join("<br>") || esc(T1_ASK3)); step(kids, q + 1, bz); }
      else { say([text, T1D.rules.close].filter(Boolean).map(esc).join("<br>")); const fin = newRow(q + 1); fin.classList.add("t1row"); inq(fin, q + 1, "final"); document.getElementById("talk").appendChild(fin); }
      saveSession();
    }
  }
}
// 番号は③から（フリートークはない）。吹き出しの札はAIではないので「弊社」
rowLabel = q => `<span class="qnum">${NUM[q - 1] || q}</span>`;
say = (f => (html, gave, hole, at) => { f(html, gave, hole, at); const t = [...document.querySelectorAll("#talk .ai .tag")].filter(x => x.textContent === "AI"); t.forEach(x => { x.textContent = "弊社"; }); })(say);
