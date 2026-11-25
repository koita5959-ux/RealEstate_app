# 不動産PR版（pr-fudosan/web/）

サンプルHP「AIボット不動産」（pr-fudosan/site/、/sample/）と一緒に動く、不動産PR版のボットと管理画面。TYPE1・TYPE2・TYPE3。査定スキルはない。

- `*_main.html`：メイン画面。サンプルHPのボットの枠に入る（?embed=1。?site=bot＝「AIボット不動産」の初期状態、なし＝このブラウザのお試し設定）
- `*_try.html`：管理画面（お試し設定）。サンプルHPのモードのボタンから開く（?url=サンプルHPのURL で読み込み済みにして開く）
- `*_report.html`：利用状況（TYPE2・TYPE3）。このブラウザの体験の記録を読む
- `replay.html`：開発利用状況の再表示の窓（メイン画面と管理画面をタブで）
- `1_select_category.html`：TYPE1 の分類の表（閲覧のみ）
- `data/`：市区町村・TYPE1 の分類と候補の表・見返し試験のURL一覧

ブラウザの保存の名前の頭は `sales:`（鑑定PR版の `kantei:` と分ける）。
