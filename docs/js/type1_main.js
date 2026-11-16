// ---- タイプ1：設問のあとを、AIではなく選択肢で進める（js/type1.js の組み立てを使う） ----
// ④＝カテゴリー別の選択肢（数字つき・理由つき）→ 返事 → ⑤ → 返事 → 問い合わせ。書き欄は置かない（企画書8章）
let T1S = null, T1L = null, T1O = null;
onSurvey = (f => (s, t) => { T1S = s; return f(s, t); })(onSurvey);
fillLand = (f => (sh, r, area) => { S.landRaw = r; return f(sh, r, area); })(fillLand);
const t1Place = () => { const a = String(ADDR || ""), c = String(PLACE || ""); const town = a.replace(/^.*?[都道府県]/, "").replace(/^.*?[市区町村]/, "").replace(/[0-9０-９丁目番地\-−ー].*$/, ""); return town || c.replace(/^.*?[都道府県]/, ""); };
function t1Btn(label, sub, cls) {
  const b = document.createElement("button"); b.className = "t1b" + (cls ? " " + cls : "");
  b.innerHTML = `<span class="t1l">${esc(label)}</span>` + (sub ? `<span class="t1s">${esc(sub)}</span>` : "");
  return b;
}
function t1Mail(where, kind) { // kind：mail＝詳しくはメールで／none＝この中にない／final＝締め
  ev("t1_exit", { kind, at:where });
  S.sheet.選んだ出口 = kind === "none" ? "この中にない（" + where + "）" : kind === "mail" ? "詳しくはメールで（" + where + "）" : "締めから問い合わせ";
  inquiryBar(); const b = document.getElementById("inqOpen"); if (b) b.click();
}
function t1Done(row, b) { row.classList.add("done"); row.querySelectorAll("button").forEach(x => { x.disabled = true; if (x !== b) x.classList.add("t1off"); }); b.classList.add("chosen"); }
async function goStep(i, lead) {
  if (i !== 0) return;
  say(lead);
  await t1Load();
  T1O = t1Shop();
  T1L = landOf(T1S, S.sheet, S.landRaw, S.around, S.area, t1Place());
  const c = t1Compose(T1L, T1O.biz), R = T1D.rules;
  S.sheet.タイプ1の分け = `${T1D.categories[T1L.cat]}／条件札：${T1L.tags.map(t => T1D.tags[t]).join("・") || "なし"}`;
  const row = newRow(4); row.classList.add("t1row");
  const add = (i, at) => {
    const o = T1D.options[i], g = c.grey[i];
    const b = g ? t1Btn(o.label, `${g.reason} →「${T1D.options[g.goto].label}」を見る`, "grey")
      : t1Btn(o.label, t1Sub(T1L, i), c.first && c.first.id === i ? "first" : "");
    if (c.first && c.first.id === i && !g) b.insertAdjacentHTML("afterbegin", `<span class="t1m">${esc(R.firstMarkLabel)}（${esc(c.first.why)}）</span>`);
    b.onclick = () => g ? row.querySelector(`button[data-id="${g.goto}"]`)?.click() : pick4(i, b);
    b.dataset.id = i; (at || row).appendChild(b);
  };
  c.main.forEach(i => add(i));
  if (c.more.length) {
    const m = t1Btn(R.moreLabel, c.more.map(i => T1D.options[i].label).join("・"), "more");
    m.onclick = () => { m.remove(); c.more.forEach(i => add(i, null)); row.appendChild(row.querySelector(".none")); };
    row.appendChild(m);
  }
  const no = t1Btn(R.always[0], "", "none"); no.onclick = () => { t1Done(row, no); t1Mail("④", "none"); }; row.appendChild(no);
  document.getElementById("talk").appendChild(row);
  inquiryBar();
  saveSession();
  function pick4(id, b) {
    t1Done(row, b);
    const o = T1D.options[id];
    PATH.push({ press:o.label, q:4, opt:c.main.indexOf(id) + 1 }); renderRoute();
    ev("choice", { q:4, press:o.label, id, from:c.origin[id] });
    S.sheet.相談目的 = esc(o.label);
    me(o.label);
    const r = t1Reply(T1L, T1O.biz, id, c.origin, T1O);
    say([r.uke, r.facts, r.body, r.ask].filter(Boolean).map(esc).join("<br>"));
    const r5 = newRow(5); r5.classList.add("t1row");
    r.next.forEach((n, k) => {
      const b5 = t1Btn(n.label, ""); r5.appendChild(b5);
      b5.onclick = () => {
        t1Done(r5, b5);
        PATH.push({ press:n.label, q:5, opt:k + 1 }); renderRoute();
        ev("choice", { q:5, press:n.label, id:n.id });
        me(n.label);
        say(esc(n.text || T1D.rules.close));
        const fin = newRow(6); fin.classList.add("t1row");
        const fb = t1Btn(R.finalLabel, "ピンの場所・土地の様子・選んだ道を添えます", "final");
        fb.onclick = () => { t1Done(fin, fb); t1Mail("締め", "final"); };
        fin.appendChild(fb); document.getElementById("talk").appendChild(fin);
        say(esc(R.close), null, null, fin);
        saveSession();
      };
    });
    const mb = t1Btn(R.inquiryLabel, "ピンの場所・土地の様子・選んだ道を添えます", "mail"); mb.onclick = () => { t1Done(r5, mb); t1Mail("⑤", "mail"); }; r5.appendChild(mb);
    const nb = t1Btn(R.always[0], "", "none"); nb.onclick = () => { t1Done(r5, nb); t1Mail("⑤", "none"); }; r5.appendChild(nb);
    document.getElementById("talk").appendChild(r5);
    saveSession();
  }
}
// 番号は④⑤⑥（フリートークはない）。吹き出しの札はAIではないので「弊社」
rowLabel = q => `<span class="qnum">${NUM[q - 1] || q}</span>`;
say = (f => (html, gave, hole, at) => { f(html, gave, hole, at); const t = [...document.querySelectorAll("#talk .ai .tag")].filter(x => x.textContent === "AI"); t.forEach(x => { x.textContent = "弊社"; }); })(say);
