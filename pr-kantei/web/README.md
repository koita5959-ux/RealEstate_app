# 鑑定PR版（pr-kantei/web/）

サンプルHP「AIボット鑑定」（pr-kantei/site/、/sample-kantei/）と一緒に動く、鑑定PR版のボットと管理画面。TalkSession・MultiSession。査定スキル（js/satei.js）がある。

- `*_main.html`：メイン画面。サンプルHPのボットの枠に入る（?embed=1。?site=kantei＝「AIボット鑑定」の初期状態、なし＝このブラウザのお試し設定）
- `*_try.html`：管理画面（お試し設定）。保存がないときの初期値は鑑定事務所
- `*_report.html`：利用状況。このブラウザの体験の記録を読む
- `replay.html`：開発利用状況の再表示の窓（メイン画面と管理画面をタブで）

ブラウザの保存の名前の頭は `kantei:`（不動産PR版の `sales:` と分ける）。
