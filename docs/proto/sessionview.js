// 「利用状況」の表示部品。利用者の利用状況の画面（自分の体験）と、開発利用状況の「再表示」（保存された他のセッション）で共有する。
// 渡されるのは構造化した記録（state）。訪問者が書いた文字が入るので、HTML にするときは必ず escape する。
window.SessionView = (function () {
  const NUM = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const rate = st => (st.pub && st.pub.usdJpy) || 150;
  const yen = (st, usd) => (usd * rate(st)).toLocaleString("ja-JP", { maximumFractionDigits: usd * rate(st) < 10 ? 2 : 0 }) + "円";

  function route(st) {
    const p = st.path || [];
    if (!p.length) return '<span class="hint">まだ選んだボタンはありません。</span>';
    return "<b>通った道</b>　" + p.map(x => (NUM[x.q - 1] || x.q) + (x.opt ? `の${x.opt} ${esc(x.press)}${x.type ? "：" + esc(x.type) : ""}` : `「${esc(x.type)}」`)).join(" → ");
  }
  function usage(st) {
    const u = st.usage || {};
    return u.n
      ? `AI（Claude）とのやり取り：<b>${u.n}往復</b>（入力 ${(u.tin || 0).toLocaleString()}・出力 ${(u.tout || 0).toLocaleString()} トークン）<br>この体験でかかった費用の目安：<b>約${yen(st, u.costUsd || 0)}</b>（推定）`
      : "まだAIとのやり取りはありません（④から先でAIが返事をします）。";
  }
  function cost(st) {
    const p = st.pub;
    return p && p.ready
      ? `相談1件あたり、平均で<b>約${yen(st, p.avgUsd)}</b>（多めの場合で約${yen(st, p.p90Usd)}）。月300件なら、AI利用分で<b>約${yen(st, p.avgUsd * 300)}</b>（試用${p.sessions}件の平均からの推定。サーバー・保守は別）。`
      : "試用のデータがたまると、ここに「相談1件あたり・月◯件なら」の目安が出ます。";
  }
  function sheet(st) {
    const sh = st.sheet || {};
    const rows = Object.entries(sh).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v ? esc(v) : '<span class="empty">未取得（現地確認へ）</span>'}</td></tr>`).join("");
    const sig = st.signals || [];
    return `<h2>データシート（対話の結果として）</h2><table class="data">${rows}</table>
    <h2>要所レポート（弊社向け）</h2>
    <div class="sheet">
      <h3>電話の入口になる一言</h3>
      「先日の見立ての続きです。接道（${esc(sh.接道 || "未確認")}）を、現地で一緒に確かめたくてお電話しました。」
      <h3>押さえるべき点</h3>
      ・客が自分の言葉で語ったこと：${sh.事情 ? "「" + esc(sh.事情) + "」" : "（書いていない。選択だけで進んだ）"}<br>
      ・相談目的：${esc(sh.相談目的 || "（まだ選んでいない）")}<br>
      ・土地勘（${esc(st.near || "")}）：${esc(st.localKnowledge || "（登録なし）")}<br>
      ・AIが途中で見立てを直した点：${esc(st.revised || "（直していない）")}
      <h3>AIの浅さの記録（会話が詰まった所）</h3>
      ${sig.length ? "・" + sig.map(esc).join("<br>・") : "（なし）"}
    </div>`;
  }
  return { esc, route, usage, cost, sheet };
})();
