# RealEstate_app

不動産屋のHPに置く、問い合わせ前の相談ボット（TYPE1 選択式／TYPE2 対話型／TYPE3 AI型）と、その管理画面・セールス用のサンプルHP。

設計の背景は `_works/`（ファイル名は「日付_筆者_テーマ.md」）。最初の企画書は [`_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md`](_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md)。

## ディレクトリ構成（2026-11-24 から版ごとのフォルダ）

1つの版＝1つのフォルダ。どの版にも `web/`（画面・部品・データ）と `prompts/`（AIへの指示）がある。

```text
RealEstate_app/
├─ core/server/   全部の版で使うサーバー（AIへの問い合わせ・HPの読み取り・公開データ・メール・開発利用状況）
├─ dev/           開発の本線（プロトタイプ）            → /RealEstate_app/dev/
│  ├─ web/        メイン画面・管理画面・利用状況（*_main / *_admin / *_report）、js/、data/
│  └─ prompts/    AIへの指示（system.txt＝TYPE3、system_talk*.txt＝TYPE2）
├─ dev-satei/     作業の版：査定スキル（建物の簡易の見立て）→ /RealEstate_app/dev-satei/。仕上がったら dev へ
├─ sales/         セールス版（開発の安定版を写す）
│  ├─ web/        サンプルHPの枠に入るボット・お試し設定（*_main / *_try / *_report） → /RealEstate_app/sales/
│  ├─ site/       サンプルHP「AIボット不動産」と広告ページ                           → /RealEstate_app/sample/
│  └─ prompts/
├─ clients/       店用（受注したら dev を複製して「番号_店名」で作る）
├─ archive/       古い試作（/RealEstate_app/archive/）
├─ tools/         見返し試験・テスト記録の受け渡し・地区一覧づくり
├─ deploy/        コンテナ内 Nginx の設定（web.conf）、ホスト Nginx の location
├─ testbed/       読み取りの試験に使う店の一覧
├─ _works/        企画書・相談記録・報告書
├─ data/          記録・取得データ（Git 外）
└─ secrets/       キー（Git 外）
```

## 版の流れ

- 作業の版（例：dev-satei＝査定スキル）は dev を複製して作り、仕上がったら dev に取り込む。
- セールス版は dev の安定した版を写す。sales を直接直さない。
- 店用は dev を複製する。店ごとの指示は `clients/<店>/prompts/`。
- サーバーは、画面の場所（/RealEstate_app/<版>/）を見て、その版の `prompts/` を使う。版に指示がなければ dev のものを使う。指示を直したら、再起動しなくても次の往復から効く。
- このブラウザの保存（localStorage）は版ごとに名前を分ける（セールス版は `sales:` 付き）。

## 動かし方

`docker compose up -d --build`（このフォルダで）。公開は https://taskboard.asuscomm.com/RealEstate_app/ （ホスト Nginx → 127.0.0.1:8110）。
古いURL（/docs/…、/docs/sales/…）は新しい場所へ転送する。
