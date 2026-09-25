# Apollo IPO

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

未設定の場合、大量保有報告書のチェックのみスキップされ、それ以外の更新（JPX・価格・地合い）は通常どおり実行されます。

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
