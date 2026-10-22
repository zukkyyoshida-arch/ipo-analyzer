# Apollo IPO モバイルアプリ化 設計書（2026-09-25 / v2 確定版）

実装エージェントはこの文書を唯一の仕様として扱う。判断に迷ったら「スマホで片手で読める・押せる」「投資助言と誤解されない文言」「データが無い項目は正直に『未取得』」の3原則で決める。

## 0. 決定事項（技術選定）

- 土台は既存 **Next.js 16（App Router / TypeScript strict / Tailwind v4 / Turbopack）** を継続。`src/lib/scoring/*`（テスト済み純関数）・`src/lib/checklist/*`・`src/hooks/*`（localStorage 永続化）・`scripts/updater/*`（JPX + Yahoo Finance + EDINET）はそのまま活かす
- UI は **スマホファーストで全面作り直し**（ボトムタブバー・カードUI・safe-area・44px タップ領域・ダークテーマ既定＋ライト自動切替）
- **PWA 化**（`app/manifest.ts` + 手書き最小 Service Worker + アイコン + iOS ホーム画面追加対応）。Serwist/next-pwa は使わない（バンドラー非依存の手書きが Next 16/Turbopack で最も確実）
- **Capacitor 8（`@capacitor/core` `@capacitor/cli`）の前提整備**。`capacitor.config.ts` は `CAP_SERVER_URL` 環境変数があれば `server.url` でデプロイ済みURLを読むラッパー方式、無ければ `webDir: 'out'`。`npx cap add ios/android` は Xcode/Android Studio が要るため今回は実行しない（README に手順を書く）
- 名称は **Apollo IPO**（Streamlit 版のブランドを継承）。`short_name` も "Apollo IPO"。appId `com.zukky.apolloipo`
- データは **実データへ置き換える**（§5）。Streamlit 版の X センチメント（捏造値）・Gemini/Ollama の AI 要約・架空銘柄 999A/999B・3銘柄固定のプレIPO診断は**持ち込まない**

## 1. 情報設計（ボトムタブ5つ＋詳細）

| タブ | ルート | 内容 | 由来 |
|---|---|---|---|
| ホーム | `/` | ①地合いカード（自動判定 sentiment + 日経/グロース250トレンド + 直近初値騰落平均。手動上書き中はその旨） ②KPIタイル4枚（対象銘柄数／直近90日の初値騰落平均／直近90日の公募割れ率／直近上場のトップパフォーマー=初値比騰落率最大）③今後14日のイベント（BB開始・抽選・購入期間・上場日を日付順のタイムライン。データが無ければ「上場予定」のみ）④スコア上位ピックアップ3件（総合スコア降順、データ十分な銘柄のみ）⑤需給ハイライト（既存 `selectSupplyDemandHighlights`） | Streamlit「Market Radar」＋「Secondary Pickups」 |
| 銘柄 | `/ipos` | セグメント（すべて／予定／BB中／上場済）＋検索（名前・コード）＋ソート（上場日↓／総合スコア↓／初値比騰落率↓）＋フィルタシート（市場・ウォッチのみ・データ十分のみ）。カード一覧（下記カード仕様） | Next.js「銘柄一覧」 |
| 銘柄詳細 | `/ipo/[code]` | ヘッダー（名前・コード・市場・ステータス・ウォッチ星）／価格カード（公開価格・初値・現在値・初値比%・公募比%、`/api/quote/[code]` でライブ値と90日スパークライン。取得失敗時は静的値）／2軸スコアゲージ（需給・ファンダ・総合）／需給ハイライト理由／スコア内訳（項目カードの縦積み・折りたたみ）／基本情報（key-value 縦積み）／日程タイムライン／BB申込状況（証券会社ごとの行）／投資判断チェックリスト（既存）／類似IPO／メモ | Streamlit「IPO Deep Dive」＋Next.js詳細 |
| スクリーナー | `/screener` | プリセット3種（§2）＋手動条件（売上成長率下限・VC比率上限・吸収金額上限・市場・黒字のみ・上場からの日数）。結果はカード。見出しは「条件一致」。「推奨／お宝／買い」は禁止 | Streamlit「お宝ゴールド」「堅実2倍株」「Secondary Pickups」を統合 |
| BB | `/bb` | 銘柄ごとのカード（BB期間・抽選日・購入期間）＋証券会社チップ（タップでステータス変更＝native select）／ステータス別集計／資金拘束目安。対象は status が upcoming/bb_open/priced の銘柄＋既に申込記録がある銘柄 | Next.js「BB管理」 |
| 設定 | `/settings` | スコア重みプリセット＋スライダー（ステッパー±ボタン併設）／地合い（自動／手動）／証券会社係数／テーマ（自動・ダーク・ライト）／データ更新日時（market.json の updatedAt）／PWA インストール案内（iOS: 共有→ホーム画面に追加）／免責全文 | Next.js「設定」 |

- ボトムタブは「ホーム／銘柄／スクリーナー／BB／設定」。詳細ページでは「銘柄」タブをアクティブ表示
- 旧 `/`（一覧）は `/ipos` へ移動。旧URLからの互換は不要（未公開のため）

### 銘柄カード仕様（一覧・スクリーナー・ホーム共通 `IpoCard`）
上段: ステータスチップ＋コード＋市場 ／ 銘柄名（太字・1行省略） ／ テーマタグ（最大3つ）
中段: 3列ミニ表（上場日／公開価格／初値比%）。値が無い項目は「—」
下段: 需給・ファンダのスコアピル。**データ不足（§5 completeness が `insufficient`）なら「基本情報 未取得」チップを出し、スコアピルは出さない**
右上: ウォッチ星（44px タップ領域）。カード全体が詳細へのリンク

## 2. スクリーナーのプリセット（`scratch/backtest/report.md` の検証結果を反映）
1. **高成長×流動性（順張り）**: 売上成長率 ≥30% かつ 直近出来高 ≥50万株 かつ 現在値 ≥ 初値。検証で唯一プラスだった入口条件
2. **BB参加候補**: status が upcoming/bb_open/priced かつ 吸収金額 ≤30億 かつ オファリングレシオ ≤30%（0＝未取得は除外しない）かつ 市場=グロース
3. **ウォッチ中**: ウォッチリスト
- 旧「初値から大きく下げた銘柄を高評価」の逆張りは採用しない
- 純関数 `src/lib/screener/index.ts`（`applyScreener(ipos, criteria, ctx)`）と `src/lib/screener/screener.test.ts` を必ず用意

## 3. デザイントークン（`globals.css` に CSS 変数、Tailwind v4 `@theme inline` で `bg-surface` 等として使えるように）

```
ダーク（既定）                     ライト（prefers-color-scheme: light または data-theme="light"）
--bg:          #0b0f1a             #f5f7fb
--surface:     #141a2b             #ffffff
--surface-2:   #1c2438             #eef2f8
--border:      #263043             #dde3ee
--text:        #eef1f8             #0f172a
--text-muted:  #8b95ab             #5b6478
--accent:      #f5c451  (Apollo ゴールド: ブランド・アクティブタブ・強調)
--accent-2:    #38bdf8  (情報・リンク。Streamlit版のシアンを落ち着かせた色)
--up:          #22c55e  (騰落プラス。Streamlit版と同じ「緑＝上昇」)
--down:        #ef4444
--warn:        #f59e0b
```
- `<html data-theme="dark|light">` を設定画面のテーマ選択で切替（既定 "auto" = メディアクエリ）。`localStorage` キー `ipo-analyzer:theme:v1`。初期描画のちらつき防止のため `layout.tsx` の `<head>` に同期スクリプトを1つ入れる
- フォント: `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`。数値は `font-variant-numeric: tabular-nums`
- 日本語改行: `body { word-break: auto-phrase; overflow-wrap: anywhere; line-break: strict; }`
- カード 16px 角丸、境界線 1px、影なし。タップ時 `active:opacity-80`
- タップ領域 44px 以上（`min-h-11`）。`touch-action: manipulation`
- safe-area: `viewport-fit=cover`。ボトムタブ `padding-bottom: max(env(safe-area-inset-bottom), 8px)`、`main` は `padding-bottom: calc(64px + env(safe-area-inset-bottom))`、トップバー `padding-top: env(safe-area-inset-top)`
- コンテンツ幅: `max-w-lg mx-auto`（PCでも中央1カラム。1280px でも横はみ出しゼロ）。ボトムタブは同じ幅で中央固定
- スクロール中のトップバーは `sticky top-0 backdrop-blur`

## 4. PWA / Capacitor
- `src/app/manifest.ts`: name "Apollo IPO"、short_name "Apollo IPO"、start_url "/"、display "standalone"、background_color "#0b0f1a"、theme_color "#0b0f1a"、lang "ja"、icons 192/512（purpose any）＋512 maskable
- アイコン: `public/icons/icon.svg`（濃紺背景＋ゴールドの上向き矢印/ロケットの簡素なマーク）を原本に `rsvg-convert`（/opt/homebrew/bin/rsvg-convert が使える）で `icon-192.png` `icon-512.png` `icon-maskable-512.png` `apple-touch-icon.png`(180) を生成
- `layout.tsx`: `export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{media:'(prefers-color-scheme: dark)', color:'#0b0f1a'}, {media:'(prefers-color-scheme: light)', color:'#f5f7fb'}] }`、`metadata.appleWebApp = { capable: true, statusBarStyle: 'black-translucent', title: 'Apollo IPO' }`、`metadata.robots = { index: false, follow: false }`（個人用ツール）、`metadata.icons.apple`
- Service Worker: `public/sw.js` 手書き（install で app shell `/`, `/ipos`, `/screener`, `/bb`, `/settings`, `/manifest.webmanifest`, アイコンをキャッシュ／fetch はナビゲーション＝ネットワーク優先・失敗時キャッシュ→`/offline` フォールバック、静的アセット `/_next/static/`＝キャッシュ優先／`/api/` はキャッシュしない）。`src/components/pwa/RegisterSw.tsx`（`process.env.NODE_ENV === 'production'` のときのみ登録）。`src/app/offline/page.tsx` を用意
- Capacitor: devDependencies に `@capacitor/core` `@capacitor/cli`（v8）。`capacitor.config.ts`（上記方針）。package.json scripts: `"cap:sync": "npx cap sync"`, `"cap:ios": "npx cap open ios"`, `"cap:android": "npx cap open android"`。`.gitignore` に `/ios` `/android` は**追加しない**（後で cap add したとき git 管理したいため）

## 5. データ（実データ化）
- `scratch/backtest/data/ipo_list.csv`（169銘柄: code,name,listing_date,market,offer_price,first_price,lead_underwriter,absorption_oku）と `fundamentals.csv`（code,vc_ratio,sales_growth,is_profitable,lockup_days,lockup_has_15x,mcap_offer_oku,absorption_oku,source）を **`public/data/ipos.base.json` へ変換**する Python スクリプト `scripts/import_backtest_data.py` を作る（再実行可能・冪等）
  - 既存 base の 10 件はサンプル（数値が説明用）のため、CSV に同じコードがあれば **CSV を優先**して置き換える。CSV に無い既存 10 件のうち架空の 601A〜604A は base から除く。それ以外（実在コードだがCSVに無い）は残す
  - 変換規則: `code,name,market(グロース/スタンダード/プライム 以外は「グロース」扱いにせず、`market` は3値なので地方市場等は「スタンダード」に寄せず**除外**),listingDate,offeringPrice=offer_price,initialPrice=first_price(空はnull),leadUnderwriter,absorptionAmount=fundamentals.absorption_oku(無ければ ipo_list.absorption_oku、無ければ 0),vcRatio,financials.revenueGrowth=sales_growth,financials.isProfitable,lockup.days,lockup.hasPriceRelease=lockup_has_15x,marketCap=mcap_offer_oku,status="listed"`。不明フィールドは `merge.ts` の `skeletonFromAuto` と同じ既定値。`sector`/`description` は空、`theme` は `src/lib/market/theme-tagging.ts` があれば適用、無ければ空配列。`dataSource` は型に無いので入れない（source は `scripts/` 側のログに残す）
  - `Ipo` 型に合わせ `bbPeriod/allotmentDate/purchasePeriod` は空文字、`priceRange` は `{low: offer, high: offer}`、`assumedPrice = offer`、`priceRangePosition = null`
- `src/lib/completeness.ts`（純関数＋テスト）: `assessCompleteness(ipo): { level: 'full'|'partial'|'insufficient', missing: string[] }`。`insufficient` = 公開価格が null かつ 吸収金額 0（＝JPX 発見スケルトン）。`partial` = 公開価格はあるが BB 日程・売上成長率・VC 比率のいずれかが既定値。UI はこれで表示を切り替える
- `src/app/api/quote/[code]/route.ts`: `yahoo-finance2` の `chart(\`${code}.T\`, {period1: 120日前, interval:'1d'})` で `{code, price, prevClose, changePct, closes:[{date, close, volume}], updatedAt}` を返す。`export const revalidate = 600`。失敗時は 404/JSON `{error}`。コードは `/^[0-9A-Z]{4}$/` で検証
- 詳細ページのスパークラインは依存追加なしの **インライン SVG**（`src/components/ui/Sparkline.tsx`）。チャートライブラリは入れない

## 6. コンプライアンス（既存方針を継続・強化）
- 禁止語（src 配下に出してはならない）: 買い／買う／売り推奨／推奨／おすすめ／お宝／必勝／爆益／テンバガー／勝てる／儲か。「条件一致」「スコア上位」「機械的集計」「参考情報」に統一
- 全ページ共通の免責は設定タブに全文、各画面の末尾に1行（既存 `Disclaimer` を流用可）

## 7. ファイル分担（並列実装の境界。**自分の担当外のファイルは編集しない**。共有ファイルに変更が必要なら成果物の `sharedChangeRequests` に書く）

| 担当 | 触ってよいファイル |
|---|---|
| foundation | `src/app/layout.tsx` `src/app/globals.css` `src/app/manifest.ts` `src/app/offline/page.tsx` `src/app/api/quote/[code]/route.ts` `src/components/ui/*`（Card, Section, KpiTile, Chip, Segmented, BottomSheet, ListRow, ScoreGauge, Sparkline, EmptyState, Stepper, IconButton, WatchStar(44px版に書き直し) など） `src/components/nav/*`（BottomTabBar, TopBar） `src/components/pwa/*` `src/components/Header.tsx`（TopBar に書き換え） `src/components/WatchStar.tsx`（44px化） `src/components/IpoCard.tsx`（§1 の共通カード。ipos/home/screener が使う） `src/components/Disclaimer.tsx`（トークン対応） `src/components/ScoreBadge.tsx`（トークン対応） `src/hooks/useTheme.ts` `public/icons/*` `public/sw.js` `capacitor.config.ts` `package.json`（依存・scripts追加のみ） `.claude/launch.json` |
| data | `scripts/import_backtest_data.py` `public/data/ipos.base.json` `src/lib/completeness.ts` `src/lib/completeness.test.ts` `src/lib/quote.ts`（quote API の型と fetch ヘルパー） |
| home | `src/app/page.tsx` `src/components/home/*` `src/components/SentimentBanner.tsx`（トークン対応で書き直し可） `src/components/SupplyDemandHighlights.tsx`（lint エラー修正含め書き直し） `src/lib/home/*`（KPI・イベント抽出の純関数＋テスト） |
| ipos | `src/app/ipos/page.tsx` `src/components/ipos/*` `src/components/IpoListClient.tsx`（書き直し）。共通カード `IpoCard` は foundation が作るものを使う |
| detail | `src/app/ipo/[code]/page.tsx` `src/components/detail/*` `src/components/IpoDetailClient.tsx`（書き直し） `src/components/ScoreBreakdown.tsx`（カード縦積みに書き直し） `src/components/InvestmentChecklist.tsx`（トークン対応の最小修正のみ） `src/components/BbStatusSelect.tsx`（トークン対応） |
| screener | `src/app/screener/page.tsx` `src/components/screener/*` `src/lib/screener/*` |
| bb | `src/app/bb/page.tsx` `src/components/bb/*` `src/components/BbManagerClient.tsx`（書き直し） |
| settings | `src/app/settings/page.tsx` `src/components/settings/*` `src/components/SettingsClient.tsx`（書き直し） |
| 共有（読み取り専用） | `src/lib/scoring/*` `src/lib/checklist/*` `src/hooks/useLocalStorage.ts` `useSettings.ts` `useUserData.ts` `src/types/*` `src/lib/repository.ts` `src/lib/merge.ts` `src/lib/format.ts` `src/lib/highlights.ts` `src/lib/market/*` `src/data/brokers.ts` `scripts/updater/*` |

- 既存ファイルの**削除は禁止**（本人裁定: 削除は確認が要る）。不要になったファイルは中身を書き換えて使うか、未使用のまま残して `obsoleteFiles` に列挙する
- localStorage キーは変更禁止: `ipo-analyzer:settings:v2` `ipo-analyzer:watchlist:v1` `ipo-analyzer:bb:v1` `ipo-analyzer:notes:v1`
- `"use client"` は必要なコンポーネントだけ。ページは Server Component でデータ取得（`getAllIpos`/`getMarketData`/`getIpoByCode`/`getBrokers` 等 `repository.ts` の既存関数）し、Client に props で渡す既存パターンを踏襲
- 詳細ページの `generateStaticParams` は既存を維持（SSG）

## 8. 検証基準（納品ゲート）
- `npx tsc --noEmit` エラー0 / `npm run lint` エラー0 / `npm test` 全通過 / `npm run build` 成功
- 375px・1280px で全ルート（`/` `/ipos` `/ipo/<任意コード>` `/screener` `/bb` `/settings` `/offline`）の `document.documentElement.scrollWidth <= window.innerWidth`
- ボトムタブの各リンク高さ ≥44px、`aria-current="page"`、`nav aria-label="メインナビゲーション"`
- `/manifest.webmanifest` `/sw.js` `/icons/icon-192.png` `/icons/icon-512.png` `/apple-touch-icon.png` が 200
- 禁止語 grep（§6）が src 配下でゼロ
- 見出し（h1/h2）が文節途中で折れていない（`getClientRects().length` が 1、または `<wbr>`/`<span class="inline-block">` で文節単位に分割済み）
