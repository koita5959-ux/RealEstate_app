// 4画面共通のヘッダー（ページタイトル＋他の画面へのボタン）と、画面の行き来。
// 使い方：各画面に <header id="appbar" data-current="user|admin|report|dev" data-title="タイトル"> を置き、直後でこのファイルを読み込む。
// 色の約束：青＝利用者の視点の画面／赤＝開発者の視点の画面。「利用状況」は、メイン画面にセッション（体験の記録）がなければグレー。
(function () {
  const BASE = new URL(".", document.currentScript.src).href; // …/docs/proto/

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
    user:   { label: "メイン画面へ", url: "./",               name: "reUser",     cls: "btn-user" },
    admin:  { label: "管理画面へ",   url: "admin_mode.html",  name: "reAdminWin", cls: "btn-dev" },
    report: { label: "利用状況",     url: "report.html",      name: "reReport",   cls: "btn-user", needsSession: true },
    dev:    { label: "開発利用状況", url: "../../api/admin/", name: "reDevWin",   cls: "btn-dev" },
  };
  const ORDER = ["user", "admin", "report", "dev"];

  const css = document.createElement("style");
  css.textContent = `
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

  const hasSession = () => { try { return !!localStorage.getItem("reSession"); } catch (e) { return false; } };
  const bar = document.getElementById("appbar");
  const current = bar.dataset.current;
  window.name = SCREENS[current].name; // 他の画面から「ここへ」と呼ばれたとき、同じ画面を見つけられるように名前を付ける
  // 開いている「利用状況」の窓へ合図を送る通路（再表示・体験中の表示への切り替え）。同じブラウザの、同じアドレスの画面どうしで届く
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("reReport") : null;

  const h1 = document.createElement("h1"); h1.textContent = bar.dataset.title || "";
  const nav = document.createElement("nav"); nav.className = "gonav"; nav.setAttribute("aria-label", "画面の移動");
  bar.classList.add("appbar");
  bar.prepend(h1);
  bar.appendChild(nav);

  const Shell = (window.Shell = {
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
        if (key === current) continue;
        const s = SCREENS[key], off = s.needsSession && !hasSession();
        const a = document.createElement("a");
        a.className = s.cls + (off ? " off" : "");
        a.href = BASE + s.url; a.textContent = s.label;
        if (off) { a.title = "まだ体験の記録がありません（メイン画面で「評価する」を押すと使えます）"; a.setAttribute("aria-disabled", "true"); }
        a.onclick = e => Shell.go(key, e);
        nav.appendChild(a);
      }
    },
  });
  Shell.refresh();
  window.addEventListener("storage", e => { if (e.key === "reSession" || e.key === null) Shell.refresh(); });
})();
