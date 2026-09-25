# Apollo IPO Phase 2 — 共有コンテキスト（設計・実装エージェント向け／2026-09-25）

## ゴール
本人の要望「投資家として判断に必要な情報を盛り込んだ最高のアプリにしたい」。既存のスマホファースト Next.js PWA（公開済: https://apollo-ipo.zukky-yoshida.workers.dev）に、投資判断に必要なデータ・実証統計・BB戦略・イベント通知を追加する。

## 現状（検証済みの事実）
- Next.js 16.2.10 / App Router / TS strict / Tailwind v4（トークン: `bg-bg bg-surface bg-surface-2 border-border text-text text-muted text-accent text-accent-2 text-up text-down text-warn`）/ vitest 154件全通過 / lint 0 / build 成功（`/ipo/[code]` は SSG 181件、ホームは force-dynamic）
- 画面: ボトムタブ5つ `/`（ホーム）`/ipos`（銘柄）`/screener` `/bb` `/settings` ＋ `/ipo/[code]` ＋ `/offline`。設計書 `scratch/mobile-design.md`（§3 トークン、§6 禁止語、§7 ファイル分担、§8 納品ゲート）
- データ層: `public/data/ipos.base.json`（157件・手動/CSV由来、型 `IpoBase = Ipo`）＋ `ipos.auto.json`（134件・updater 管理、型 `IpoAuto`）→ `src/lib/merge.ts` の `mergeIpos(base, auto)` で 181件の `Ipo`。`src/lib/repository.ts` が読み込み。`market.json` は地合い
- 型: `src/types/ipo.ts`（Ipo: bbPeriod/allotmentDate/purchasePeriod/assumedPrice/priceRange/offeringPrice/priceRangePosition/publicShares/saleShares/overAllotment/absorptionAmount(億)/offeringRatio(%)/marketCap(億)/vcRatio(%)/lockup{days,hasPriceRelease,coverage}/leadUnderwriter/underwriters[]/financials{revenue,revenueGrowth,operatingProfit,isProfitable}/per/psr/sameDayListings/sameWeekListings/initialPrice/status/similarIpoCodes/initialVolume/currentPrice/recentVolume/firstEarningsDate/largeHoldingReport）、`src/types/data.ts`（IpoAuto, MarketData）、`src/types/broker.ts`（Broker{id,name,lotteryType:equal|proportional|stage|point,requiresDeposit,penaltyOnCancel,underwriterCoefficient}, BbStatus）、`src/types/userData.ts`（BbState = code→brokerId→{status,memo}, NotesState, WatchlistState）
- updater: `scripts/updater/main.ts`（JPX 発見 → status 導出 → 価格 yahoo-finance2（1件300ms待機）→ EDINET → auto 書込 → market.json）。`jpx.ts`（cheerio でテーブル解析）、`config.ts`（USER_AGENT・HTTP_TIMEOUT_MS・FILES）。実行 `npm run update:data`
- スコア: `src/lib/scoring/*`（11項目 -2〜+2 × 重み → 0〜100、需給9項目＋ファンダ2項目、プリセット supplyDemand/balanced/fundamental in `weights.ts`）。`src/lib/completeness.ts`（full/partial/insufficient、insufficient はスコア非表示）
- 主幹事係数: `src/data/brokers.ts` の DEFAULT_BROKERS 8社（SBI/SMBC日興/野村/大和/みずほ/マネックス/楽天/松井）
- localStorage キー（変更禁止）: `ipo-analyzer:settings:v2` `ipo-analyzer:watchlist:v1` `ipo-analyzer:bb:v1` `ipo-analyzer:notes:v1` `ipo-analyzer:theme:v1`。フックは `src/hooks/useLocalStorage.ts` `useSettings.ts` `useUserData.ts`
- 詳細ページ: `src/app/ipo/[code]/page.tsx` → `src/components/IpoDetailClient.tsx`（価格カード PriceCard（`/api/quote/[code]` で 120日終値＋スパークライン）／ScoreGauges／ScoreBreakdown／BasicInfoList／Timeline／BbStatusList／InvestmentChecklist／SimilarIpos（similarIpoCodes が空なので現状ほぼ非表示）／NotesEditor）
- ホーム: `src/app/page.tsx` → `src/components/home/HomeClient.tsx`（地合いカード・KPI4枚（`src/lib/home/index.ts` computeKpis）・今後14日のイベント EventTimeline・TopPicks・需給ハイライト）
- BB: `src/app/bb/page.tsx` → `src/components/BbManagerClient.tsx`（ステータス別集計 BbSummary・資金拘束目安（`estimatedLockAmount`=価格×100株、ステータス applied/won のみ）・BbIpoCard で証券会社別ステータス）
- スクリーナー: `src/lib/screener/index.ts`（applyScreener、プリセット「高成長×流動性」「BB参加候補」「ウォッチ中」）
- Cloudflare: `wrangler.jsonc`（name apollo-ipo、nodejs_compat、assets binding ASSETS、services WORKER_SELF_REFERENCE）、`open-next.config.ts`（Static Assets incremental cache＝無料枠、ISR 時間再検証なし）。`npm run preview` でローカル Workers 実行、`npm run deploy` で本番。**本番デプロイ・GitHub push は本人確認が必要（このセッションでは実行しない）**
- バックテスト基盤: `scratch/backtest/`（Python venv: `./venv/bin/python`、`rules.py` `backtest.py` `data/ipo_list.csv`(169件: code,name,listing_date,market,offer_price,first_price,lead_underwriter,absorption_oku) `data/fundamentals.csv`(code,vc_ratio,sales_growth,is_profitable,lockup_days,lockup_has_15x,mcap_offer_oku,absorption_oku,source) `data/prices/*.csv` 日足155銘柄 `data/nikkei.csv`）。`report.md` の結論: セカンダリー逆張りは負け、BB参加判断（初値売り）が勝率7〜8割の主戦場。効く要因: 吸収金額（小さいほど良）、オファリングレシオ（低いほど良）、主幹事別公募割れ率、仮条件上限決定、ロックアップ、地合い

## 未取得データの実態
- JPX 発見銘柄（auto の `discovered:true` 40件。うち上場予定 2026-08〜10 の約24件）は name/market/listingDate/価格 しか無い。BB期間・仮条件・公開価格・吸収金額・幹事・VC・業績が全て未取得 → UI は「基本情報 未取得」
- base の CSV 由来 157件も bbPeriod/allotmentDate/purchasePeriod は空、publicShares/saleShares/overAllotment/offeringRatio は 0、underwriters は主幹事1社のみ、priceRange は公開価格と同値（仮条件レンジ不明）、priceRangePosition null

## 第2データソースの調査結果（2026-09-25 実測）
- **kabu.96ut.com**: robots.txt は `/wp-admin/` のみ Disallow（取得可）。1銘柄1ページ `https://kabu.96ut.com/article/ipo/<YYYY><NNN>/`（例 2026035 = ルクレ 648A。タイトル「ルクレ(648A)のIPO新規上場情報」）。ページ内テーブル（`<tr>` 行の th/td）に以下が全部ある:
  仮条件決定日／ＢＢ期間（開始: 2026/09/29 (火) ～ 終了: 2026/10/02 (金)）／公募価格決定（=抽選日相当）／購入申込期間／上場予定日／公募株式数（総計・公募・売出・売出株式比率）／O.A.分／発行済株数／OR（オファリング・レシオ %）／想定価格／仮条件価格（未発表 or "1,200円～1,400円"）／公募価格（未決定 or 円）／吸収金額（想定・公開・初値の3列）／時価総額／主幹事証券／幹事団と割当（証券会社名・割当数・割当(%)・抽選配分）／会社概要（所在地・設立・従業員数・監査法人）／業績テーブル（決算期・売上・経常利益・当期利益・変化率%）／EPS・BPS・配当／大株主（氏名・株数・割合・ロックアップ日数）／既存株主総計（ロックアップ対象株数・カバー率）／VC推定保有（内ロックアップ）／SO／初値予想（**使わない**：他人の予想値は取り込まない）
  一覧の発見方法: 記事番号は年ごとの連番（2026001〜）。`https://kabu.96ut.com/article/category/ipo/`（カテゴリ一覧）、`https://kabu.96ut.com/post-sitemap*.xml`（サイトマップ）、またはトップページの新着リンクから `article/ipo/2026NNN/` を収集できる。存在しない番号は 404
- **ipokiso.com**: curl では 403（UA 問わず）→ **使わない**
- **kabutan.jp**: robots に `Crawl-delay: 3`、`/ipo/` は 404（構造未確認）→ 第2候補（今回は使わない）
- 取得規律: 1リクエスト/秒以上の間隔、UA 明示、タイムアウト 20秒、失敗はスキップして続行、robots 遵守、個人利用の範囲。取得した数値は「出典 URL」と「取得日時」を必ず残す

## 本人裁定・規律（必ず守る）
- 禁止語（src 配下に出さない）: 買い／買う／売り推奨／推奨／おすすめ／お宝／必勝／爆益／テンバガー／勝てる／儲か。「条件一致」「スコア上位」「機械的集計」「参考情報」「実績分布」に統一。他サイトの「初値予想」「BB参加姿勢」等の主観評価は取り込まない
- 既存ファイルの削除は禁止（本人確認が必要）。不要ファイルは残置して報告
- localStorage キーは変更禁止（互換維持）。新キーは `ipo-analyzer:<name>:v1` 形式
- 秘密情報は `.env` のみ。コードに平文で書かない
- 新ルール・重みは実装前に `scratch/backtest/` で実証する
- 納品ゲート: `npx tsc --noEmit` 0 / `npm run lint` 0 / `npm test` 全通過 / `npm run build` 成功 / 375px・1280px で横はみ出し 0 / 禁止語 grep 0
- 「今日」はサーバー側で計算して props で渡す（クライアントで Date.now を使わない・純関数は todayIso 引数）
- ページは Server Component でデータ取得し Client へ props。`"use client"` は必要なコンポーネントだけ

## Phase 2 のスコープ（HANDOFF の優先順）
1. 上場予定銘柄の完全データ化（96ut から取得 → 新レイヤー `public/data/ipos.enriched.json`、型 `IpoEnriched`、merge 優先順 base（手動）＞ enriched ＞ auto（価格））
2. 「類似IPOの初値実績」と統計（吸収金額帯×市場×地合い別の初値騰落率分布、主幹事別公募割れ率、OR帯別）
3. BB参加スコアの再校正（実証データで重み初期値を決め直し、需給重視プリセット更新）
4. BB戦略ボード（申込先の優先順位＝幹事配分×抽選方式×前受金、口座別資金拘束（期間の重なり）、抽選日・購入期限カレンダー）
5. イベントカレンダー（ロックアップ解除日 listingDate+90/180、1.5倍条項判定、決算発表日、大量保有）
6. プッシュ通知（Web Push VAPID ＋ Workers Cron、購読は KV。iOS はホーム画面追加後のみ）
7. セカンダリー分析の深化（6ヶ月ローソク＋25日MA＋出来高の自前 SVG、公開価格・初値ライン）
（8 クラウド同期 D1、9 ネイティブ化、10 M1 夜間ジョブ は本人判断待ち。設計メモのみ可）

## 追記（2026-09-25 17:28 実測）
- 96ut の記事一覧は **サイトマップで発見するのが最も確実**: `https://kabu.96ut.com/sitemap.xml`（インデックス）→ `post-sitemap.xml` 〜 `post-sitemap6.xml` の中に `https://kabu.96ut.com/article/ipo/<YYYYNNN>/` が並ぶ（post-sitemap6.xml だけで 2024040〜2026035 の 152 件。2026 年は 2026001〜2026035 の 35 件）。カテゴリ一覧 `article/category/ipo/`（10件/ページ・`page/N/` でページング）は補助
- したがって **2024〜2026 の全銘柄（約190件）を 1 req/秒で取得しても 3〜4 分**。上場予定だけでなく base の CSV 由来 157 件も BB 期間・仮条件・株数・OR・幹事団・ロックアップ・業績で補完できる（統計の母数が増える）。記事ページのタイトル「<社名>(<コード>)のIPO新規上場情報」からコードを取り、code をキーに突合する
- ベースライン確認済み: `npx tsc --noEmit` OK / vitest 154 件通過 / backtest venv（pandas 3.0.3）動作 / `data/prices` 159 ファイル
- 96ut のフィクスチャ HTML を保存済み: `scratch/phase2/fixtures/96ut-2024040.html`（カドス 211A・上場済・幹事団割当と抽選配分枚数あり）、`96ut-2026020.html`（チャットプラス 598A・上場済 2026）、`96ut-2026035-upcoming.html`（ルクレ 648A・上場予定・仮条件未発表）。テスト用フィクスチャはここからコピーして使う（再取得不要）。「幹事団と割当」テーブルには 証券会社名／割当数（株）／割当(%)／抽選配分（枚）がある。「初値予想」「直前予想」「BB参加姿勢」行は取り込まない
