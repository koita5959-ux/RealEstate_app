# RealEstate_app

不動産ロケーション評価Webアプリ（プロトタイプ）。

設計の背景・方針は [`_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md`](_works/2026-11-01_ClaudeAI_不動産ロケーション評価Webアプリ設計企画書.md) を参照。

## ディレクトリ構成

```text
RealEstate_app/
├─ _works/        企画書・相談記録・報告書（ファイル名は「日付_筆者_テーマ.md」。筆者は ClaudeAI / ClaudeCode / ユーザー）
├─ docs/          Webアプリ本体（GitHub Pages配信用）
│  ├─ index.html
│  ├─ css/
│  ├─ js/
│  └─ data/       manifest.json・市区町村別データ（ビルド生成物）
├─ tools/         データライブラリー生成（import / normalize / validate / build）
├─ data-source/   取得した生データ（RAW・改変しない）
├─ data-build/    正規化・変換の中間データ
└─ logs/          データ生成時のログ
```

> 企画書内では配信用フォルダを `public/` と表記していますが、GitHub Pagesの
> 「ブランチから直接配信」機能が `/docs` のみ対応のため、このリポジトリでは
> 実フォルダ名を `docs/` としています。役割・設計思想は企画書の `public/` と同一です。

## プレビュー

GitHub Pages: `https://koita5959-ux.github.io/RealEstate_app/`
（Settings → Pages → Source: Deploy from a branch → main / docs で有効化）

## データ更新

Webアプリ本体とは別に、`tools/` 以下のスクリプトで `data-source/` → `data-build/` → `docs/data/` への変換・検証・公開を行う。Webアプリ側のコードを書き換えずにデータだけを更新できる構造を維持する。
