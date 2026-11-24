# 版ごとのフォルダへの組み替え手順（案）

2026-11-24　Claude Code（ユーザーと合意した方向。着手前の手順）

## 目的（ユーザー）
- 版（開発・セールス・店ごとの「＊＊不動産」版）を、フォルダで確実に見分けられる形にする。
- スキルアップ（査定スキル）は、今の開発版とは別に進める。
- セールス版は開発の最新でよい（安定した開発版を写す）。

## 形
```
RealEstate_app/
  core/            全部の版で使う仕組み（サーバー本体・公開データ・地区の表・メール）
  dev/             開発の本線（今の docs/ 直下）
  dev-satei/       スキルアップの作業場（dev の複製から始める）
  sales/           セールス版（今の docs/sales/）＋サンプルHP（今の RealEstate_Site/）
  clients/
    001_＊＊不動産/  店用（受注したら dev を複製）
```
各版のフォルダ：`web/`（画面・部品・データ）＋ `prompts/`（AIへの指示 system*.txt と、版で変わる表）。

## サーバーの考え方
- 指示（prompts/）は版ごとに持つ。api は起動時に全部の版の指示を読み、画面が送る版の名前（ver）で使い分ける。
- 査定スキルはサーバーのプログラム（計算 building.js など）にも手を入れる。そこで api を2本にする：
  - **安定の api**（core/server）：dev・sales・clients が使う。
  - **作業の api**（dev-satei/server、core/server の複製）：dev-satei だけが使う。仕上がったら core/server に取り込み、作業の api は止める。
- 記録（data/）は1つのまま。版の名前を記録に入れて、開発利用状況で見分ける。

## URL
- 新：/RealEstate_app/〈版〉/…（例 /RealEstate_app/dev/3_ai_main.html、/RealEstate_app/sales/…）
- 今のURL（/docs/…、/docs/sales/…）は 301 で新しい場所へ送る。
- **サンプルHP /sample/?r= は変えない**（送り先リストに載る）。
- 店用のURLの名前の付け方は未決（番号だけか、番号＋店名か）。

## 手順
1. フォルダを移す（git mv で履歴を残す）。docker-compose.yml・deploy/web.conf の置き場所を直す。
2. api：版ごとの指示を読み、ver で使い分ける。画面の部品が自分の場所から ver を送る。
3. 古いURLの 301、ホスト Nginx はそのまま（/RealEstate_app/ を渡すだけなので変更不要の見込み）。
4. 確かめ：dev・sales の全画面を ?ai=off のブラウザで開き、今までと同じに動くか。サンプルHP・広告ページ・お試し設定・管理画面・開発利用状況・メール（MailHog）。AIを呼ぶ確認は事前に申告して1回だけ。
5. 問題なければ commit・push。そのあと dev-satei と作業の api を作り、査定スキルに入る。

## 気をつけること
- 保存（localStorage）の名前は版ごとに分ける（今は sales: 付きで分けている。dev-satei・clients も同じ形に）。
- Windows 側（S:）での一括移動は、サーバーの新しい内容を古い内容で上書きしたことがある。移動・編集はサーバー側（ssh tb1）で行う。
