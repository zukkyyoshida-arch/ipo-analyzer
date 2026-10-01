# カブナビ

日本の IPO（新規上場）銘柄の情報を整理し、**需給スコア**と**ファンダスコア**の 2 軸で機械的に比較するための、個人投資家向けの PWA（Progressive Web App）です。ブックビルディング（BB）の申込状況や資金拘束の管理もできます。

Next.js（App Router）+ TypeScript + Tailwind CSS で実装した、スマホファーストのモバイルアプリです。ボトムタブバーによる 5 画面構成、ダークテーマ既定（ライト自動切替）、PWA としてホーム画面に追加できます。環境変数・データベース不要で Vercel にそのままデプロイできます。ユーザーの入力（ウォッチリスト・BB 申込状況・メモ・スコア重み・地合い設定）はブラウザの localStorage に保存されます。

## 免責事項

**本アプリは公開情報をユーザー設定ルールで機械的に整理する個人用ツールです。投資助言を目的とせず、特定銘柄の売買の可否を示すものではありません。投資判断はご自身の責任で行ってください。公開情報を機械的に取得したもので正確性・完全性を保証しません。**

- スコアは、ユーザーが設定した重みに基づく機械的な集計値です。特定銘柄の評価や売買判断を示すものではありません。

## 画面構成（ボトムタブ 5 つ＋詳細）

| タブ | ルート | 内容 |
|---|---|---|
| ホーム | `/` | 地合いカード、KPI タイル（対象銘柄数・直近90日初値騰落平均・公募割れ率・直近トップパフォーマー）、今後14日のイベントタイムライン、スコア上位ピックアップ、需給ハイライト |
| 銘柄 | `/ipos` | セグメント（すべて／予定／BB中／上場済）、検索、ソート、フィルタシート、カード一覧 |
| 銘柄詳細 | `/ipo/[code]` | 価格カード（ライブ株価・90日スパークライン）、2軸スコアゲージ、スコア内訳、基本情報、日程タイムライン、BB申込状況、投資判断チェックリスト、類似IPO、メモ |
| スクリーナー | `/screener` | プリセット3種（高成長×流動性／BB参加候補／ウォッチ中）＋手動条件によるカード一覧 |
| BB | `/bb` | 銘柄ごとの BB 期間・抽選日・購入期間、証券会社別ステータス管理、資金拘束目安の集計 |
| 設定 | `/settings` | スコア重みプリセット・スライダー、地合い設定、証券会社係数、テーマ、データ更新日時、PWA インストール案内、免責全文 |

## セットアップ

前提: Node.js 20 以上。

```bash
npm install      # 依存関係のインストール
npm run dev      # 開発サーバー起動（http://localhost:3000）
npm run build    # 本番ビルド
npm run test     # ユニットテスト（vitest）
npm run lint     # ESLint
```

## PWA としてスマホにインストールする

デプロイ済みの URL にスマホの標準ブラウザでアクセスし、以下の手順でホーム画面に追加できます（`/settings` タブにも同じ案内があります）。

- **iOS（Safari）**: 共有ボタン →「ホーム画面に追加」
- **Android（Chrome）**: メニュー（⋮） →「アプリをインストール」または「ホーム画面に追加」

ホーム画面のアイコンから起動すると、アドレスバー無しのスタンドアロン表示になり、オフライン時は `/offline` にフォールバックします（`public/sw.js` の Service Worker がキャッシュを管理）。

## Capacitor でネイティブ化する

このリポジトリは Capacitor 8 の前提整備（`capacitor.config.ts` / devDependencies）まで済んでいます。実際に iOS/Android のネイティブシェルを生成するには、Xcode（iOS）または Android Studio（Android）がインストールされた環境で以下を実行してください。

```bash
npm i -D @capacitor/ios @capacitor/android
npx cap add ios       # または: npx cap add android

# デプロイ済みの Web 版 URL をネイティブシェルから読み込む場合
export CAP_SERVER_URL="https://<your-deployed-url>"
npx cap sync

npx cap open ios       # Xcode で開く（npm run cap:ios でも同様）
# npx cap open android  # Android Studio で開く（npm run cap:android でも同様）
```

`CAP_SERVER_URL` を設定しない場合は `capacitor.config.ts` が `webDir: 'out'`（静的ビルド出力）を参照します。

### Apple App Store 審査（ガイドライン 4.2）に関する注記

Apple の [App Store Review Guidelines 4.2](https://developer.apple.com/app-store/review/guidelines/) は、Web サイトの単純なラッパー（ネイティブ機能を持たないだけの WebView 表示）を却下対象としています。このリポジトリをそのまま `cap add ios` しただけの状態では 4.2 に抵触するおそれがあるため、App Store への提出前に **プッシュ通知（BB締切・抽選日のリマインド等）** や **ホームウィジェット**、**ネイティブ共有シート** など、Web 版に無いネイティブ機能を追加しておくとよいでしょう。個人利用（TestFlight・自分の端末への直接インストール）の範囲であれば審査は発生しません。

## データの出典

- **銘柄データ（`public/data/ipos.base.json`）**: `scratch/backtest/data/ipo_list.csv` ＋ `fundamentals.csv`（バックテスト検証用に集めた実データ、169銘柄）を `scripts/import_backtest_data.py` で変換したものが土台です。東証以外の市場区分（名証・札証・福証・複合区分等）の行は除外しています。架空銘柄（旧サンプルの 601A〜604A）は含みません。
- **自動更新データ（`public/data/ipos.auto.json` / `public/data/market.json`）**: `scripts/updater/` が JPX 新規上場ページ・Yahoo Finance（`yahoo-finance2`）・EDINET をポーリングして生成します。手動管理データ（base）を上書きしません（`src/lib/merge.ts` 参照）。
- **大量保有報告書（`public/data/holdings.json`）**: `scripts/updater/holdings.ts` が EDINET API v2 から IPO 銘柄（base/auto の全銘柄）あての大量保有報告書・変更報告書・訂正報告書を取り、直近 180 日分を保持します（夜間は前回の続きの日だけ取得。リクエストは 1.5 秒間隔の逐次）。注目度の計算は `src/lib/holdings/score.ts`。表示には PDL1.0 に沿った出典表記（`src/lib/holdings/types.ts` の `HOLDINGS_SOURCE_TEXT`）が必要です。
- **株主優待の先回り買い（`public/data/yutai/index.json` ＋ 権利確定月ごとの `public/data/yutai/<M>.json`）**: `scripts/updater/yutai.ts`（`npm run yutai:data`）が [大和IR 株主優待ガイド](https://yutai-guide.daiwair.co.jp/) の権利確定月別の一覧（1.5 秒間隔の逐次取得）と、Yahoo Finance（`yahoo-finance2`）の月足（過去 10 年）から、権利確定月の前月の値動き（陽線の本数・平均騰落率）を集計します。Worker のバンドルを小さく保つため、アプリは月別ファイルをブラウザから直接読みます。月足は月末にしか変わらないため月に 1 回だけ更新し（今月作成済みなら夜間ジョブでは即スキップ。作り直しは `npm run yutai:data -- --force`）、取得は個人利用の範囲にとどめます。
- **銘柄詳細のライブ株価**: `/api/quote/[code]` が `yahoo-finance2` から取得します（10分キャッシュ）。取得に失敗した場合は静的な `currentPrice` にフォールバックします。
- データアクセスは `src/lib/repository.ts` の薄いリポジトリ層に集約しています。`DATA_BASE_URL` 環境変数を設定すると、リモート JSON（base/auto/market）を ISR（5分）で取得し、未設定・取得失敗時はリポジトリ同梱の `public/data/*.json` にフォールバックします。

### 自動更新パイプラインの実行

```bash
npm run update:data
```

EDINET の大量保有報告書チェックを有効にするには、[EDINET API の利用申請ページ](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html) で無料の API キーを取得し、リポジトリ直下の `.env` に設定してください（`.env` は `.gitignore` 対象）。

```
EDINET_API_KEY=xxxxxxxx
```

未設定の場合、大量保有報告書のチェックのみスキップされ（既存の `holdings.json` はそのまま）、それ以外の更新（JPX・価格・地合い）は通常どおり実行されます。

大量保有報告書だけを取り直すときは次を実行します（Yahoo・JPX は叩かず、`holdings.json` だけを書きます。初回は 180 日分のバックフィルで 20 分ほどかかります）。

```bash
npm run holdings:data                 # 1 回の CSV 取得は既定 300 件まで
npm run holdings:data -- --max-csv 1000
```

### バックテストデータの再取り込み

```bash
python3 scripts/import_backtest_data.py
```

冪等なスクリプトです。何度実行しても同じ結果になります。

## スコアリング仕様

スコアは純関数として `src/lib/scoring/` に分離しており、ユニットテストで検証しています。各項目は生データを **-2〜+2 の整数**に正規化し、重み付き合計を **0〜100 点**に線形換算します。

### 需給スコア（初値形成に効きやすい要素）

| 項目 | 内容 |
|---|---|
| 吸収金額 | OA 込みの吸収金額。〜10億:+2 / 10〜30億:+1 / 30〜100億:0 / 100〜500億:-1 / 500億〜:-2 |
| 市場区分 | グロース:+1 / スタンダード:0 / プライム:-1 |
| 業種・テーマ性 | 人気テーマ（AI/SaaS/半導体/セキュリティ）含む:+2 / 中立:0 / 不人気タグ:-2 |
| VC 比率 × ロックアップ | VC 比率（<10% / 10-30% / >30%）とロック強度（強/中/弱）のマトリクスで +2〜-2 |
| 公募売出比率 | 公募中心:+1 / 同程度:0 / 売出中心:-1、放出比率>30% でさらに -1（下限 -2） |
| 主幹事 | 証券会社マスタの係数（設定画面で調整、デフォルト 0） |
| 地合い | 自動判定または設定画面で手動選択。強い:+2 / 普通:0 / 弱い:-2（全銘柄共通） |
| 上場日程の過密度 | 同日上場あり:-1、同週 3 件以上でさらに -1 |
| 公募割れリスク | 「吸収金額 100 億超 × 売出中心 × 人気テーマなし」の複合条件で -2、それ以外 0 |

### ファンダスコア

| 項目 | 内容 |
|---|---|
| 業績成長性 | 成長率>30%かつ黒字:+2 / >15%かつ黒字:+1 / 黒字低成長:0 / 赤字高成長:-1 / 赤字低成長:-2 |
| バリュエーション | PSR<5:+1 / 5-15:0 / >15:-1（赤字で PER 算出不能でも PSR で判定） |

### 換算方法

各軸で「各項目の点数 × 重み」の合計を求め、その取りうる最小値（Σ重み ×(-2)）と最大値（Σ重み ×(+2)）を [0, 100] に線形マッピングしてスコアとします（全重み 0 の場合は中立の 50 点）。総合スコアは 2 軸の単純平均です。

## Cloudflare Workers へのデプロイ（標準）

ホスティングは Cloudflare Workers（無料枠）を標準にしています。アダプターは [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)、ISR のキャッシュは Workers Static Assets（追加インフラ不要・無料）です。設定ファイルは `wrangler.jsonc` と `open-next.config.ts` にあります。

### 初回（1回だけ・本人操作）

```bash
npx wrangler login
```

ブラウザが開くので Cloudflare アカウントでログインして許可します。

### デプロイ

```bash
npm run deploy
```

内部で `opennextjs-cloudflare build`（Next.js のビルド）→ `opennextjs-cloudflare deploy` が走り、`https://apollo-ipo.<アカウントのサブドメイン>.workers.dev` に公開されます。デプロイ前にローカルの Workers ランタイムで確認したい場合は `npm run preview`（http://localhost:8787）を使います。

### 運用上の注意

- Static Assets キャッシュでは ISR の時間再検証（`revalidate` 秒指定）が効きません。時刻に依存するホーム（`/`）は `dynamic = "force-dynamic"` でリクエストごとに計算し、それ以外の静的ページはビルド時点の内容を配信します。
- **データ更新（`npm run update:data`）を反映するには再デプロイが必要**です。M1 の夜間ジョブ等から `npm run update:data && npm run deploy` を回す運用にすると自動化できます。
- push 時の自動デプロイにしたい場合は、Cloudflare ダッシュボードの「Workers & Pages → Create → Import a repository」で本リポジトリを接続します（Workers Builds、無料枠 3,000 分/月）。
- **利用量の番人**（`.github/workflows/usage-guard.yml`）: 毎時、Cloudflare GraphQL Analytics でアカウント全体の今月（UTC）のリクエスト数を数え、9,000,000 件（`USAGE_GUARD_LIMIT`）を超えたら本番 Worker をメンテ画面（`scripts/guard/maintenance/`）に差し替え、Issue を立ててジョブを失敗させます。
  - トークンに「Account Analytics: Read」が必要です。API エラー時は差し替えず失敗通知のみ。
  - 復旧は翌月 1 日（UTC）以降に「Deploy to Cloudflare Workers」を workflow_dispatch で実行します。
- Capacitor でネイティブ化するときは `CAP_SERVER_URL` に上記の公開 URL を設定します。

### Vercel でも動きます

環境変数・データベース不要のため、Vercel に「New Project」からリポジトリをインポートするだけでもそのまま動作します（その場合 ISR は Vercel 側で機能します）。

## Phase 2 の運用

### 詳細データの取り込み（`npm run enrich:data`）

```bash
npm run enrich:data
```

96ut の IPO 記事から BB期間・仮条件・幹事配分・大株主・業績などを取得し、`public/data/ipos.enriched.json` に書き出します（1 リクエスト/秒の間隔、初回は約 3〜4 分）。上場済みで取得済みの記事は次回からスキップします。取得できた値は `mergeIpos` で base/auto の既定値（未取得）部分だけを埋め、手動データは上書きしません。反映には再デプロイが必要です。

### プッシュ通知（本番手順・本人確認後に実行）

```bash
npx wrangler kv namespace create PUSH_SUBSCRIPTIONS   # 表示された id を wrangler.jsonc の REPLACE_WITH_KV_NAMESPACE_ID と置き換える
npx wrangler secret put VAPID_PRIVATE_KEY             # .env の値を貼る
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_SUBJECT
npm run deploy
```

- `wrangler.jsonc` の `main` は `./worker/push-scheduled.ts`（OpenNext の fetch ＋ Cron）。Cron は毎日 23:00 UTC（08:00 JST）に通知判定を行います。事前確認は `npx tsx worker/run-push-notifications.ts --dry-run`（送信・KV 書き込みなし）。
- VAPID 鍵は `.env` のみに置きます（生成コマンドは `.env.example` のコメント参照）。ファイルやチャットに平文で書かないでください。
- **`.dev.vars` の扱い**: `npm run preview` でローカル確認するときは `.env` の値を `.dev.vars` へコピーします（gitignore 済み。wrangler は `.dev.vars` が無いときだけ `.env` を読みます）。
- `next dev` では通知購読 API（`/api/push/*`）が 503 を返します（KV なし）。動作確認は `npm run preview` で行います。
- iOS はホーム画面に追加した PWA でのみ Web Push が動きます。設定画面の「プッシュ通知」から購読し、対象はウォッチリストの銘柄です。

### イベントカレンダー（`/events`）

BB・抽選・購入期限・上場に加え、ロックアップ解除・1.5 倍ライン監視・初決算・大量保有報告の新着を今後 90 日分まとめて表示します。ホーム・銘柄一覧・BB 管理から 1 タップで移動できます。

### BB参加スコアの位置づけ

BB参加スコアは、吸収金額・OR・主幹事の公募割れ実績・仮条件の位置・VC×ロックアップ・地合いを機械的に集計した 0〜100 の参考値で、既存の需給／ファンダの 2 軸スコアとは別枠です。ホームの「BB参加候補」と BB 管理画面で使います。重みはバックテスト（168 銘柄）で 1 回だけ調整しました。根拠と限界は [scratch/backtest/report-phase2.md](scratch/backtest/report-phase2.md) を参照してください。将来の初値を示すものではありません。

## Phase 3 の運用

### 履歴データ（2015〜2023 年、`npm run enrich:history`）

```bash
npm run enrich:history   # = tsx scripts/enrich/main.ts --history --from 2015 --to 2023
```

96ut の 2015〜2023 年の IPO 記事（約 930 件）を 1 リクエスト/秒で取得し、`public/data/ipos.history.json`（型 `HistoricalIpo`）と `scratch/backtest/data/ipo_history.csv` に書き出します（約 16 分・100 件ごとに途中保存）。コード重複は新しい記事を優先し、REIT・インフラファンド（名前に「投資法人」を含むもの）は除きます。現在の収録は 869 件です。旧市場は現行 3 区分へ読み替えています（東M→グロース、JASDAQ・東2→スタンダード、東1→プライム）。

- 詳細ページの「類似条件の初値実績」と主幹事の公募割れ実績は、現行データ＋履歴を母数にし、期間（直近 3 年／2015 年以降すべて）を切り替えて表示します。履歴 JSON はサーバー側でだけ読み、クライアントへは集計結果だけを渡します。
- 抽選配分の「枚数」（`lotteryUnits`）はパーサで取り込みますが、上場済み銘柄は `enrich:data` が取得済みとしてスキップするため、既存の `ipos.enriched.json` には入っていません。上場前の銘柄は次回の `enrich:data` で埋まります。

### BB参加スコアの追加項目と公募割れ確率（実績ベース）

- BB参加スコアに「売出比率」と「直近IPOの初値動向（上場日より前の直近 5 件の初値騰落率平均）」を追加しました（各重み 2、総重み 17→21）。1,026 銘柄（2015〜2026）で検証し、採用基準（Spearman ≥ +0.10 かつ年別の 75% 以上で同じ向き）を満たした 2 項目だけを入れています。
- 詳細ページの「公募割れ確率」は、2015〜2023 年（846 件）で学習したロジスティック回帰（numpy 実装、係数は `src/lib/scoring/bb-model.json`）を BB参加スコアの各項目に当てはめた参考値です。2024〜2026 年（180 件）での検証は AUC 0.750。吸収金額が未取得、または未取得の特徴量が 3 つ以上ある銘柄には表示しません。
- 低い確率は実績より低めに出る傾向があります。根拠・閾値・限界は [scratch/backtest/report-phase3.md](scratch/backtest/report-phase3.md)、再現は `cd scratch/backtest && WRITE_MODEL=1 ./venv/bin/python recalibrate_bb_v2.py` です。
- `/events` の「イベント前後の実績」は、ロックアップ解除・1.5 倍解除到達・初回決算の前後 20 営業日の騰落率を集計した `public/data/event-stats.json` を表示します（再集計: `cd scratch/backtest && ./venv/bin/python fetch_prices.py --add-missing --refresh && ./venv/bin/python event_backtest.py`）。

### 通知の追加

プッシュ通知に「仮条件発表」（想定価格からの上振れ・下振れ）と「公開価格決定」を追加しました。Cron が前回のスナップショットを KV に保存し、差分で検知します。本番反映後の最初の Cron は初回扱いのため通知しません。既存の購読（旧 5 種別をすべて有効にしているもの）は新しい種別も有効として扱います。

### 端末間同期（Cloudflare D1・無料枠）

設定画面の「端末間同期」で、ウォッチリスト・BB 記録・メモを端末間で共有できます。

1. 1 台目で「同期キーを作成」を押す（32 文字のランダムなキーを端末で生成します）
2. 「コピー」でキーを控え、2 台目で「別の端末のキーを入力」に貼り付ける
3. 以後は設定画面を開いたときと、開いている間の変更の数秒後に自動で同期します。「今すぐ同期」で手動実行もできます

- サーバー（`/api/sync`）にはキーの SHA-256 ハッシュだけを保存します。キーを知っている人は同じ記録を読み書きできるので、他人に共有しないでください。
- 項目単位（ウォッチ=銘柄、BB=銘柄×証券会社、メモ=銘柄）でマージし、前回同期から端末側で変わった項目は端末側を、変わっていない項目はサーバー側を採用します。
- 「同期を解除」しても端末の記録は消えません。ローカルの保存キーは `ipo-analyzer:sync:v1` のみ追加で、既存キーは変えていません。

**本番の D1 マイグレーション（本人確認後に 1 回だけ実行）**

```bash
npx wrangler d1 migrations apply apollo-ipo-sync --remote   # sync_store テーブルを作成
npm run deploy
```

D1 データベース `apollo-ipo-sync` は作成済みで、`wrangler.jsonc` に binding `SYNC_DB`（`migrations_dir: "migrations"`）として登録してあります。ローカル（`npm run preview`）は `npx wrangler d1 migrations apply apollo-ipo-sync --local` で同じテーブルを作ります。D1 が無い環境では `/api/sync` は 503 を返します。

### 申込実績の振り返りと一次情報リンク

- `/bb` の末尾「あなたの実績」に、口座別の申込数・当選数・当選率（結果が分かった分だけを母数）と、当選・購入済みの記録を初値で売った場合の機械的な試算（100 株・手数料と税金は未考慮）を母数つきで表示します。
- 詳細ページの「一次情報リンク」から、株探（銘柄・適時開示）・JPX 新規上場会社情報・EDINET 書類検索・96ut 記事を新しいタブで開けます。

## ディレクトリ構成（抜粋）

```
src/
├── app/
│   ├── page.tsx              # ホーム
│   ├── ipos/page.tsx         # 銘柄一覧
│   ├── ipo/[code]/page.tsx   # 銘柄詳細
│   ├── screener/page.tsx     # スクリーナー
│   ├── bb/page.tsx           # BB管理
│   ├── settings/page.tsx     # 設定
│   ├── offline/page.tsx      # PWA オフラインフォールバック
│   ├── api/quote/[code]/     # ライブ株価API
│   └── manifest.ts           # PWA マニフェスト
├── components/               # UI コンポーネント（画面別ディレクトリ + ui/nav/pwa 共通部品）
├── data/                     # 証券会社マスタ（brokers.ts）
├── hooks/                    # localStorage 永続化フック（SSR セーフ）・テーマ
├── lib/
│   ├── repository.ts         # データアクセスの薄いリポジトリ層
│   ├── format.ts             # 表示フォーマット
│   ├── completeness.ts       # データ充足度判定
│   ├── quote.ts               # ライブ株価APIの型・fetchヘルパー
│   ├── scoring/               # スコアリング純関数 + テスト
│   ├── screener/              # スクリーナー純関数 + テスト
│   └── checklist/             # 投資判断チェックリスト純関数
└── types/                    # ドメイン型

public/
├── data/                     # ipos.base.json / ipos.auto.json / market.json
├── icons/                    # PWA アイコン一式
└── sw.js                     # Service Worker（手書き）

scripts/
├── import_backtest_data.py   # バックテストCSV → ipos.base.json 変換
└── updater/                  # JPX/Yahoo Finance/EDINET 自動更新パイプライン
```
