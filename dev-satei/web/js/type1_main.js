// ---- タイプ1：設問のあとを、AIではなく選択肢で進める（js/type1.js の組み立てを使う） ----
// ③＝店の業務内容（管理画面で並べた順）→ 返事＋問い → ④ → ⑤ → 店が足した枠の分だけ先へ。子のない選択肢の先は問い合わせだけ。
// ③から先の段には、いつでも問い合わせの出口（T1_INQ）を付ける。下の欄の同じボタンは、フォームから戻ったときだけ出す。書き欄は置かない（企画書8章）
let T1S = null, T1L = null, T1O = null, T1_OPENED = false;
inquiryBar = (f => () => { f(); const b = document.getElementById("inq"); if (b) b.style.display = T1_OPENED ? "" : "none"; })(inquiryBar);
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
  T1_OPENED = true; inquiryBar(); const b = document.getElementById("inqOpen"); if (b) b.click();
}
function t1Done(row, b) { row.classList.add("done"); row.querySelectorAll("button").forEach(x => { x.disabled = true; if (x !== b) x.classList.add("t1off"); }); b.classList.add("chosen"); }
SURVEY.lead = "この土地をもう少し詳しく確認したいので、この土地の様子を教えてください。"; // ②の前（タイプ1だけ。売り目的に寄った「値段より先に」を外す。ユーザー 11-17）
async function goStep(i, lead) { // ③の前：設問の事実の文はつなげず、③の顔ぶれで一文を選ぶ（ユーザー 11-17）。lead は使わない
  if (i !== 0) return;
  await t1Load();
  T1O = t1Shop();
  const rent = T1O.top.some(n => (n.cats || []).some(c => c === "借りたい・部屋探し" || c === "賃貸・管理"));
  say(esc(!T1O.top.length ? T1_ASK0_NONE : rent ? T1_ASK0_RENT : T1_ASK0));
  T1L = landOf(T1S, S.sheet, S.landRaw, S.around, S.area, t1Place());
  S.sheet.タイプ1の分け = `${T1D.categories[T1L.cat]}／条件札：${T1L.tags.map(t => T1D.tags[t]).join("・") || "なし"}`;
  step(T1O.top, 4, []);
  inquiryBar();
  saveSession();
  function inq(row, q, kind) {
    const b = t1Btn(T1_INQ, "ピンの場所・土地の様子・選んだ道を添えます", kind === "final" ? "final" : "mail");
    b.onclick = () => { t1Done(row, b); t1Mail(NUM[q - 1], kind); }; row.appendChild(b);
  }
  function step(list, q, trail) { // q は記録の番号（表示は q−1：4＝③）。trail＝③からここまでに選んだ節
    const row = newRow(q); row.classList.add("t1row");
    list.forEach((n, k) => { const b = t1Btn(n.label, ""); b.onclick = () => pick(n, k, b); row.appendChild(b); });
    inq(row, q, list.length ? "mail" : "final"); // ③から先のどの段にも、問い合わせの出口を必ず付ける（③が0のサイトでも行き止まりにしない）
    document.getElementById("talk").appendChild(row);
    function pick(n, k, b) {
      t1Done(row, b);
      PATH.push({ press:n.label, q, opt:k + 1 }); renderRoute();
      ev("choice", { q, press:n.label, cats:(trail[0] || n).cats || null });
      if (q === 4) S.sheet.相談目的 = esc(n.label);
      me(n.label);
      const t = trail.concat(n), kids = t1Kids(n, T1L, t), text = t1Text(n, T1L);
      if (kids.length) { say([text, t1AskOf(n, t.length - 1, t[0].cats)].filter(Boolean).map(esc).join("<br>")); step(kids, q + 1, t); }
      else { say([text, t1Close(t[0].cats)].filter(Boolean).map(esc).join("<br>")); const fin = newRow(q + 1); fin.classList.add("t1row"); inq(fin, q + 1, "final"); document.getElementById("talk").appendChild(fin); }
      saveSession();
    }
  }
}
// 番号は③から（フリートークはない）。吹き出しの札はAIではないので「弊社」
rowLabel = q => `<span class="qnum">${NUM[q - 1] || q}</span>`;
say = (f => (html, gave, hole, at) => { f(html, gave, hole, at); const t = [...document.querySelectorAll("#talk .ai .tag")].filter(x => x.textContent === "AI"); t.forEach(x => { x.textContent = "弊社"; }); })(say);
