# RealEstate_app

不動産屋のHPに置く、問い合わせ前の相談ボット（TYPE1 選択式／TYPE2 対話型／TYPE3 AI型）と、その管理画面・セールス用のサンプルHP。

設計の背景は `_works/`（ファイル名は「日付_筆者_テーマ.md」）。最初の企画書は [`_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md`](_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md)。

## ディレクトリ構成（2026-11-25 から PR版の2つ）

```text
RealEstate_app/
├─ pr-fudosan/    不動産PR版（TYPE1・TYPE2・TYPE3、査定スキルなし）
│  ├─ web/        メイン画面・管理画面（お試し設定）・利用状況（*_main / *_try / *_report）、再表示の窓、js/、data/ → /RealEstate_app/pr-fudosan/
│  ├─ site/       サンプルHP「AIボット不動産」と広告ページ → /RealEstate_app/sample/
│  └─ prompts/    AIへの指示（system.txt＝TYPE3、system_talk*.txt＝TYPE2）
├─ pr-kantei/     鑑定PR版（TalkSession・MultiSession、査定スキルあり）
│  ├─ web/        同上 → /RealEstate_app/pr-kantei/
│  ├─ site/       サンプルHP「AIボット鑑定」と広告ページ → /RealEstate_app/sample-kantei/
│  └─ prompts/
├─ core/server/   2つの版で使うサーバー（AIへの問い合わせ・HPの読み取り・公開データ・メール・開発利用状況）
├─ tools/         TYPE1 の見返し試験・テスト記録の受け渡し・地区一覧づくり
├─ deploy/        コンテナ内 Nginx の設定（web.conf）、ホスト Nginx の location
├─ _works/        企画書・相談記録・報告書
├─ data/          記録・取得データ（Git 外）
└─ secrets/       キー（Git 外）
```

## 版の決まり

- サーバーは、画面の場所（/RealEstate_app/<版>/）を見て、その版の `prompts/` を使う。版に指示がなければ不動産PR版のものを使う。指示を直したら、再起動しなくても次の往復から効く。
- 記録（セッション）にはどの版の画面かを残し、開発利用状況の再表示はその版の画面で開く。
- このブラウザの保存（localStorage）は版ごとに名前を分ける（不動産PR版は `sales:`、鑑定PR版は `kantei:`）。
- 直すときは、どちらの版か（両方か）を決めてから直す。

## 動かし方

`docker compose up -d --build`（このフォルダで）。公開は https://taskboard.asuscomm.com/RealEstate_app/ （ホスト Nginx → 127.0.0.1:8110。トップは /sample/ へ）。
古いURL（/docs/…・/dev/…・/dev-old/…・/sales/…・/sales-kantei/…）は新しい場所へ転送する（*_admin.html はお試し設定へ）。
