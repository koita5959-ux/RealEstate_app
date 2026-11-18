// 4画面共通のヘッダー（ページタイトル＋他の画面へのボタン）と、画面の行き来。
// 使い方：各画面に <header id="appbar" data-current="user|admin|report|dev" data-title="タイトル"> を置き、直後でこのファイルを読み込む。
// 色の約束：青＝利用者の視点の画面／赤＝開発者の視点の画面。「利用状況」は、メイン画面にセッション（体験の記録）がなければグレー。
(function () {
  // 丸数字（何往復目か）は、どの画面でも赤。文の中に書いた丸数字も、出たそばから赤くする
  const CN = /[①-⑳]/;
  const st = document.createElement("style"); st.textContent = ".cnum{color:#c0392b}"; document.head.appendChild(st);
  const paint = root => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n =>
      CN.test(n.data) && !n.parentElement.closest("script,style,textarea,input,option,title,.cnum,.num,.qnum") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    for (const n of list) {
      const f = document.createDocumentFragment();
      n.data.split(/([①-⑳])/).forEach(t => { if (!t) return; if (CN.test(t)) { const s = document.createElement("span"); s.className = "cnum"; s.textContent = t; f.appendChild(s); } else f.appendChild(document.createTextNode(t)); });
      n.replaceWith(f);
    }
  };
  const start = () => { paint(document.body); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 ? paint(n) : n.nodeType === 3 && n.parentElement && paint(n.parentElement)))).observe(document.body, { childList:true, subtree:true }); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  const BASE = new URL("../", document.currentScript.src).href; // …/docs/
  // サンプルHPの枠の中（?embed=1）：ヘッダーと試験用の欄を隠す。?site=bot＝このブラウザの設定を使わず、サンプルHP「AIボット不動産」の初期状態で動かす
  const QS = new URLSearchParams(location.search);
  window.RE_EMBED = QS.get("embed") === "1";
  window.RE_SITE_BOT = QS.get("site") === "bot";
  window.RE_AREA = QS.get("area") || "";
  window.RE_TRIAL = QS.get("trial") === "1"; // サンプルHPから来たテスト利用者向けの「お試し設定」（開発用の部品を出さない）
  if (window.RE_EMBED) { const s = document.createElement("style"); s.textContent = ".appbar{display:none!important}details.trace,.trig{display:none!important}"; document.head.appendChild(s); }
  // タイプ：画面のファイル名の頭（1_select_／2_talk_／3_ai_）。開発利用状況など頭のない画面は AI型へ
  const TYPE = (location.pathname.match(/\/(\d_[a-z]+_)[a-z]+\.html$/) || [, "3_ai_"])[1];
  // 体験の記録（このブラウザ）はタイプごとに分ける。AI型は前からの名前のまま
  const SKEY = TYPE === "3_ai_" ? "reSession" : "reSession_" + TYPE.replace(/_$/, "");

  // 画面の行き来：すでに開いている画面は、開き直さずに前へ出す（内容・書きかけの下書きを消さない）。なければ新しく開く
  window.goScreen = function (url, name, ev) {
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button)) return true; // Ctrl/Shift＋クリック・中ボタンは、ブラウザ標準（別タブ・別ウインドウ）に任せる
    const abs = new URL(url, location.href).href;
    try {
      const w = window.open("", name);
      if (!w) return false;
      if (w.location.href === "about:blank") w.location.href = abs; // 新しく開いたときだけ読み込む
      w.focus();
    } catch (e) { window.open(abs, name); }
    return false;
  };

  const SCREENS = {
    user:   { label: "メイン画面へ", url: TYPE + "main.html",   name: "reUser",     cls: "btn-user" },
    admin:  { label: "管理画面へ",   url: TYPE + "admin.html",  name: "reAdminWin", cls: "btn-dev" },
    report: { label: "利用状況",     url: TYPE + "report.html", name: "reReport",   cls: "btn-user", needsSession: true, not: "1_select_" }, // タイプ1の利用状況はまだない
    dev:    { label: "開発利用状況", url: "../api/admin/",     name: "reDevWin",   cls: "btn-dev" },
    cat:    { label: "分類の表",     url: "1_select_category.html", name: "reCatWin", cls: "btn-dev", only: "1_select_" }, // タイプ1だけ（③の見出しの当て方、閲覧のみ）
  };
  const ORDER = ["user", "admin", "cat", "report", "dev"];

  const css = document.createElement("style");
  css.textContent = `
  input::placeholder, textarea::placeholder { color:#b3bcc6; opacity:1; }
  .appbar { position:sticky; top:0; z-index:1000; display:flex; align-items:center; gap:6px 14px; flex-wrap:wrap; padding:8px 16px; background:#fff; border-bottom:1px solid #d9e2ec; box-shadow:0 1px 3px rgba(0,0,0,.05); font-family:system-ui,"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif; }
  .appbar h1 { font-size:17px; margin:0; font-weight:600; color:#1f2933; }
  .appbar .appextra { font-size:12px; color:#52606d; display:flex; align-items:center; gap:10px; }
  .appbar .appextra label { margin:0; font-size:12px; display:inline-flex; align-items:center; gap:4px; }
  .gonav { display:flex; gap:6px; flex-wrap:nowrap; white-space:nowrap; margin-left:auto; }
  .gonav a { display:inline-block; font:inherit; font-size:12px; line-height:1.4; padding:5px 11px; border-radius:6px; color:#fff; text-decoration:none; }
  .gonav a.btn-user { background:#1d6fb8; }
  .gonav a.btn-dev { background:#c0392b; }
  .gonav a.off { background:#c3c9d0; color:#fff; cursor:not-allowed; }
  `;
  document.head.appendChild(css);

  const hasSession = () => { try { return !!localStorage.getItem(SKEY); } catch (e) { return false; } };
  const bar = document.getElementById("appbar");
  const current = bar.dataset.current;
  if (!window.RE_EMBED) window.name = SCREENS[current].name; // 枠の中は名前を付けない（管理画面の「メイン画面へ」が枠を乗っ取らないように）。 他の画面から「ここへ」と呼ばれたとき、同じ画面を見つけられるように名前を付ける
  // 開いている「利用状況」の窓へ合図を送る通路（再表示・体験中の表示への切り替え）。同じブラウザの、同じアドレスの画面どうしで届く
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("reReport") : null;

  const h1 = document.createElement("h1"); h1.textContent = bar.dataset.title || "";
  const nav = document.createElement("nav"); nav.className = "gonav"; nav.setAttribute("aria-label", "画面の移動");
  bar.classList.add("appbar");
  bar.prepend(h1);
  bar.appendChild(nav);

  const Shell = (window.Shell = {
    skey: SKEY, type: TYPE,
    channel,
    beforeGo: null, // 画面ごとに差し込める：(key) => false で移動を止める（管理画面の「未確定の下書き」の確認など）
    go(key, ev) {
      const s = SCREENS[key];
      if (s.needsSession && !hasSession()) return false; // グレーのときは何もしない
      if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button)) return true;
      if (Shell.beforeGo && Shell.beforeGo(key) === false) return false;
      if (key === "report" && channel) channel.postMessage({ type: "live" }); // ヘッダーの「利用状況」は、体験中の表示を見に行くボタン
      return window.goScreen(BASE + s.url, s.name, ev);
    },
    refresh() { // セッションの有無で、「利用状況」のグレー表示を切り替える
      nav.innerHTML = "";
      for (const key of ORDER) {
        if (window.RE_TRIAL && key !== "report") continue; // お試し設定：利用状況（タイプ2・3）だけ
        if (key === current || (SCREENS[key].only && SCREENS[key].only !== TYPE) || SCREENS[key].not === TYPE) continue;
        const s = SCREENS[key], off = s.needsSession && !hasSession();
        const a = document.createElement("a");
        a.className = s.cls + (off ? " off" : "");
        a.href = BASE + s.url; a.textContent = s.label;
        if (off) { a.title = "まだ体験の記録がありません（メイン画面を開くと使えます）"; a.setAttribute("aria-disabled", "true"); }
        if (window.RE_TRIAL) { a.textContent = "利用状況を見る"; a.target = "_blank"; a.rel = "noopener"; a.className = "btn-user" + (off ? " off" : ""); a.onclick = e => { if (off) { e.preventDefault(); return false; } }; }
        else a.onclick = e => Shell.go(key, e);
        nav.appendChild(a);
      }
      if (current === "admin") { // この設定のボットを、サンプルHPの枠で試す（新しいタブ・ボットの位置へ）
        let r = ""; try { r = localStorage.getItem("reSampleR") || ""; } catch (e) {}
        const a = document.createElement("a");
        a.className = "btn-user"; a.textContent = window.RE_TRIAL ? "この設定でサンプルHPを試す ›" : "サンプルHPで試す"; a.target = "_blank"; a.rel = "noopener";
        a.href = new URL("../sample/", BASE).href + "?" + (r ? "r=" + encodeURIComponent(r) + "&" : "") + "type=" + TYPE[0] + "&mine=1#bot";
        a.onclick = e => { if (Shell.beforeTry && Shell.beforeTry() === false) { e.preventDefault(); return false; } };
        if (window.RE_TRIAL) a.classList.add("btn-try");
        nav.prepend(a);
      }
    },
  });
  Shell.refresh();
  if (window.RE_TRIAL && current === "admin") {
    const n = TYPE[0];
    h1.textContent = "TYPE" + n + " お試し設定 ― 御社のHPで試す";
    document.body.classList.add("trial", "trial" + n);
    const steps = { "1":["御社のHPのURLを入れて「読み込み」", "③の選択肢（HPの業務内容から拾ったもの）を見て、直す・消す・足す（直したそばに保存されます）", "右上の「サンプルHPで試す」で、この設定のボットを動かす"],
      "2":["御社のHPのURLを入れて「読み取る」（AIが店の姿をまとめます。30秒ほど）", "読み取った内容を見て、違う所を直す・足りない所を書く（直したそばに保存されます）", "右上の「サンプルHPで試す」で、この設定のボットと話す"],
      "3":["御社のHPのURLを入れて「読み取る」（AIが店の姿をまとめます。30秒ほど）", "業態と選択肢を見て、直す・足す", "右上の「サンプルHPで試す」で、この設定のボットを動かす（書き換えはそのとき反映されます）"] }[n];
    const g = document.createElement("div"); g.className = "trial-guide";
    g.innerHTML = "<b>お試しの手順</b><ol>" + steps.map(t => "<li>" + t.replace(/[<>&]/g, "") + "</li>").join("") + "</ol><small>この画面の設定は、このブラウザの中だけに保存されます。ほかの人には見えません。</small>";
    bar.after(g);
    if (n !== "1") window.addEventListener("load", () => setTimeout(() => { // 見本サイト（遠見不動産）のURLのままなら空にして、御社のURLを入れてもらう
      for (const id of ["url", "hpUrl"]) { const u = document.getElementById(id); if (u && /\/RealEstate\/?$/.test(u.value)) { u.value = ""; u.placeholder = "https://…（御社のHPのトップのURL）"; } }
    }, 300));
    const tcss = document.createElement("style");
    tcss.textContent = `.trial .appbar{background:#eaf3fb;border-bottom-color:#b9d3ea}.trial .appbar h1{color:#174a7a}.trial .gonav{gap:10px}.trial .gonav a{font-size:14px;padding:8px 16px;border-radius:999px;font-weight:700}.trial .gonav a.btn-user{background:#fff;color:#1d6fb8;border:1px solid #1d6fb8}.trial .gonav a.off{background:#fff;color:#a9b3bd;border-color:#c3c9d0}.gonav a.btn-try,.trial .gonav a.btn-try{background:#d98c1f;color:#fff;border:0;box-shadow:0 2px 6px rgba(217,140,31,.35)}.trial .gonav a.btn-try:hover{background:#c27a12}
    .trial-guide{margin:10px 16px 0;padding:10px 14px;background:#f4f9fd;border:1px solid #cfe0ef;border-radius:8px;font-size:13px;line-height:1.7;color:#1f2933;font-family:system-ui,"Hiragino Sans","Yu Gothic",sans-serif}
    .trial-guide ol{margin:4px 0 2px;padding-left:1.4em}.trial-guide small{color:#52606d}
    .trial .noticebar,.trial .trial-dev,.trial3 aside.side,.trial3 .trial-hide{display:none!important}.trial3 .wrap,.trial3 .layout{grid-template-columns:1fr!important}`;
    document.head.appendChild(tcss);
  }
  window.addEventListener("storage", e => { if (e.key === SKEY || e.key === null) Shell.refresh(); });
})();

// 管理画面：開発利用状況の再表示で設定が戻ったら読み直す（メイン画面が reRestoreStamp を書く）
if (/_admin\.html$/.test(location.pathname)) window.addEventListener("storage", e => { if (e.key === "reRestoreStamp") location.reload(); });
