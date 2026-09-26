# Apollo IPO Phase 3 — 共有コンテキスト（2026-09-25 22:10）

## 前提
- Phase 2 は本番反映済み（https://apollo-ipo.zukky-yoshida.workers.dev、ブランチ feat/mobile-app、コミット 5b53e3c/6e1b185）。設計書 `scratch/phase2/design.md`、現状 `scratch/phase2/context.md`、BB参加スコアの検証 `scratch/backtest/report-phase2.md`
- 本人裁定: **完全無料**（Cloudflare 有料機能・App Store・独自ドメイン不可。D1/KV/Cron/Workers Free のみ）。禁止語（買い／買う／売り推奨／推奨／おすすめ／お宝／必勝／爆益／テンバガー／勝てる／儲か）を src に出さない。既存ファイル削除禁止。localStorage 既存キー変更禁止（新キーは `ipo-analyzer:<name>:v1`）。秘密情報は .env のみ。新ルールは実装前に `scratch/backtest/` で実証
- ゲート: `npx tsc --noEmit` 0 / `npm run lint` 0 / `npm test` 全通過（現在 359件）/ `npm run build` と `npx opennextjs-cloudflare build` 成功 / 375px・1280px 横はみ出し0 / 禁止語0
- M1 夜間ジョブは今回やらない（Wi-Fi の都合で後回し）

## 既存の主要インターフェース（読んでから使う）
- 型: `src/types/ipo.ts`（Ipo）, `src/types/enriched.ts`（IpoEnriched, UnderwriterAllocation{name,shares,ratioPercent,lotteryUnits?}）, `src/types/push.ts`, `src/types/userData.ts`（BbState = code→brokerId→{status,memo}）, `src/types/broker.ts`
- データ: `public/data/ipos.base.json`(157) + `ipos.auto.json`(134) + `ipos.enriched.json`(191、2024〜2026) → `src/lib/merge.ts mergeIpos(base, auto, enriched?)` → 181件。`src/lib/repository.ts`（loadIpoData/getAllIpos/getEnrichedByCode/getAllEnriched/getMarketData）。`market.json.indicators.recentIpoAvgReturn`（直近10件の初値騰落率平均）
- 96ut スクレイパー: `scripts/enrich/{config,sitemap,parse96ut,main}.ts`（`runEnrich(options)`, `collectAllIpoArticleUrls`, `parse96utArticle(html,url,fetchedAt)`, `minListingYear` で対象年を絞る。テスト `scripts/enrich/parse96ut.test.ts` 41件、フィクスチャ `scripts/enrich/__fixtures__/`）。96ut のサイトマップは 2001年以降の記事を持つ（2015:100 / 2016:94 / 2017:96 / 2018:100 / 2019:92 / 2020:113 / 2021:131 / 2022:101 / 2023:104 記事）。記事の「初値」行（例「初値 | 3,210円 (公募比: +310円/+10.7%)」）、「上場予定日」「上場市場」「会社名」も本文にある。1 req/秒・UA明示・失敗はスキップ
- 統計: `src/lib/stats/index.ts`（outcomeDistributionByAbsorptionBand(allIpos, target), underwriterBreakEvenStat(s), offeringRatioBandStats, classifyAbsorptionBand 等）
- BB参加スコア: `src/lib/scoring/bb.ts`（scoreBbParticipation(ipo, settings, underwriterStat, weights?)、6項目 absorption/offeringRatioBb/underwriterTrack/priceRangePosition/vcLockup/sentiment、DEFAULT_BB_WEIGHTS = 4/4/2/3/2/2）。検証スクリプト `scratch/backtest/recalibrate_bb.py`（pandas/numpy。sklearn/statsmodels は無い。pip install 禁止）
- バックテスト基盤: `scratch/backtest/`（venv: `./venv/bin/python`、`fetch_prices.py`（yfinance 1.5.1、data/ipo_list.csv → data/prices/{code}.csv、日足は 2026-07-14 まで）、`backtest.py`、`rules.py`、`data/nikkei.csv`、`data/fundamentals.csv`）
- 通知: `src/lib/push/notify.ts`（selectNotifiableEvents(events, todayIso, {previousWatchCodes}), buildPayload, PUSH_EVENT_KINDS/LABELS）、`worker/run-push-notifications.ts`（KV `state:price-release-watch` に前回状態）、`src/lib/push/subscription.ts`（KV `sub:` 接頭辞）、設定UI `src/components/settings/PushOptIn.tsx`、`src/hooks/usePushSubscription.ts`
- BB画面: `src/components/BbManagerClient.tsx`, `src/components/bb/{BbSummary,BbIpoCard,BrokerPriorityList,FundLockCalendar}.tsx`, `src/lib/bb/{priority,fundLock}.ts`（rankBrokersForIpo は UnderwriterAllocation[] を受ける）
- 詳細: `src/app/ipo/[code]/page.tsx`（サーバーで underwriterStat/outcome を計算して props）, `src/components/IpoDetailClient.tsx`, `src/components/detail/{PriceCard,ScoreGauges,BbScoreBreakdown,OutcomeDistribution,UnderwriterPriority,EnrichedInfo,...}.tsx`
- 設定: `src/components/SettingsClient.tsx`（ThemeSection → PushOptIn → DataSection → InstallGuide → Reset の順）
- Cloudflare: `wrangler.jsonc`（main ./worker/push-scheduled.ts、KV PUSH_SUBSCRIPTIONS id e8375f823321454b9327644a7b05f121、cron 0 23 * * *）。API ルートは `getCloudflareContext()` で bindings を取る（`src/lib/push/kv.ts` 参照）。`npm run preview` でローカル Workers（KV/D1 はローカル模擬）
- UI 部品: `src/components/ui/{Card,Section,ListRow,Chip,Segmented,BottomSheet,KpiTile,EmptyState,Stepper,IconButton,ScoreGauge,Sparkline,Candlestick}.tsx`。トークン bg-surface/text-muted/text-accent/text-accent-2/text-up/text-down/text-warn。タップ領域 min-h-11。"use client" は必要な所だけ。「今日」はサーバー計算 or マウント後に JST（`src/lib/date.ts jstTodayIso`）

## Phase 3 のスコープ（本人「全部やって」）
精度:
1. 学習データを 2015〜2023 年へ拡大（96ut。約930記事）→ 圧縮した履歴データ `public/data/ipos.history.json`（型 HistoricalIpo）と `scratch/backtest/data/ipo_history.csv`
2. BB参加スコアの要因追加検証: 売出比率（売出÷(公募+売出)）・幹事団の社数・同週上場件数・IPO地合い（直近5件の初値騰落率平均、上場日時点で既知のもののみ）
3. IPO地合いを日経平均ではなく直近IPOの初値騰落率で判定（2 の検証結果次第で置換/追加）
4. ロジスティック回帰（numpy 実装、walk-forward: 〜2023 学習 → 2024〜 検証、キャリブレーション確認）で「公募割れ確率」を出し、係数 JSON を TS で読む。文言は「公募割れ確率（実績ベース）X%（母数N件）」「参考情報」
5. セカンダリーのイベント検証: ロックアップ解除（90/180日）・1.5倍解除到達・初回決算またぎ の前後20営業日の平均/中央値/勝率（価格パネルを今日まで更新してから）
機能:
6. 自分の申込実績の振り返い（/bb に「あなたの実績」: 口座別の申込数・当選数・当選率、当選/購入済×(初値−公開価格)×100株 の初値売り想定損益、母数表示）
7. 通知の追加: 仮条件発表（想定価格からの上振れ/下振れ）・公開価格決定（KV に前回スナップショットを持ち差分で検知）
8. 抽選配分「枚数」の表示（幹事団の順位に「抽選枠 X枚」。型は lotteryUnits?: number|null を追加済み。パーサで「抽選配分」列を取り込む）
9. 詳細ページに一次情報リンク（EDINET 書類検索・JPX 新規上場会社情報・kabutan 適時開示 `https://kabutan.jp/stock/news?code=<code>&b=k`・kabutan 銘柄 `https://kabutan.jp/stock/?code=<code>`）。外部リンクは target=_blank rel=noopener
10. 端末間同期（Cloudflare D1・無料）: 「同期キー」（端末で生成した 32 文字のランダム文字列。QR不要、コピペで他端末に入力）でウォッチ・BB記録・メモを D1 に保存/取得。認証はキーのハッシュのみ（Cloudflare Access は使わない＝カード登録が要るため）。Last-write-wins（項目ごとの updatedAt）。設定画面に「端末間同期」セクション
