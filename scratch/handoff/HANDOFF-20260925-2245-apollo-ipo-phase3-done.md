# HANDOFF: Apollo IPO Phase 3 本番反映済み — GitHub push と M1 夜間ジョブは本人指示待ち

作成日時: 2026-09-25 22:52
作成元セッション: ipo-analyzer / /Users/kazukiyoshida/ipo-analyzer
作成元セッションID: local_e5195427-5656-4136-b59d-b8d781ae3118

## 今やっていること

スマホ版 Apollo IPO（Next.js PWA / Cloudflare Workers）を「投資判断に必要な情報を盛り込んだ最高のアプリ」にする。Phase 2 は本番反映済み、Phase 3 はローカル完成・コミット済み（c59b778）。次は本番反映（本人確認が必要）と、Wi-Fi 復旧後の M1 夜間ジョブ。

## 確定した事実

- [検証済み] 本番 URL https://apollo-ipo.zukky-yoshida.workers.dev は **Phase 3 まで**反映済み（Version 91e4e574、2026-09-25 22:50。D1 マイグレーション --remote 適用済み）。KV `PUSH_SUBSCRIPTIONS`（id e8375f823321454b9327644a7b05f121）・VAPID の 3 secret・Cron `0 23 * * *` は本番設定済み
- [検証済み] ブランチ `feat/mobile-app`。コミット: 5b53e3c（Phase 2）→ 6e1b185（KV id）→ **c59b778（Phase 3）**。GitHub へは未 push（remote origin=zukkyyoshida-arch/ipo-analyzer、main のみ存在）
- [検証済み] Phase 3 のゲート: `npx tsc --noEmit` 0 / `npm run lint` 0 / vitest 478 件通過（25 ファイル）/ `npm run build` 190 ページ / `npx opennextjs-cloudflare build` 成功 / `wrangler deploy --dry-run` gzip 1.69MB（無料枠 3MB 以内）/ 375px・1280px で `/ /ipos /ipo/618A /ipo/648A /bb /events /settings /screener /offline` の scrollWidth ≤ innerWidth / 禁止語 0 / 既存ファイル削除なし
- [検証済み] Phase 3 の中身: (1) 96ut 履歴 2015〜2023 年 869 銘柄 `public/data/ipos.history.json`（526KB）＋ `scratch/backtest/data/ipo_history.csv`（`npm run enrich:history`） (2) BB参加スコアに「売出比率」「直近IPOの初値動向（直近5件平均）」を追加（各重み2、全期間 Spearman +0.552→+0.588。幹事団社数・同週件数は相関なしで不採用） (3) 公募割れ確率 = numpy ロジスティック回帰（学習 2015〜2023 846件→検証 2024〜2026 180件 AUC 0.750、ブライア 0.153 vs 基準 0.184）。係数 `src/lib/scoring/bb-model.json`、`src/lib/scoring/bbProbability.ts`、詳細ページ「公募割れ確率（実績ベース）」カード (4) イベント検証 `scratch/backtest/report-phase3-events.md`（ロックアップ解除 n=139 後20日中央値 +0.2%・上昇50% ／ 1.5倍到達 n=25 −6.8%・32% ／ 初回決算 n=3 で使えない）→ `/events` に「イベント前後の実績」 (5) `/bb`「あなたの実績」（口座別当選率・初値売り想定損益） (6) 幹事団の抽選枠（枚）表示（`ipos.enriched.json` を `--refetch-all` で全 191 件再取得、188 件に lotteryUnits） (7) 詳細ページ「一次情報リンク」（株探×2・JPX・EDINET・96ut） (8) 通知に「仮条件発表」「公開価格決定」（KV `state:price-snapshot` の差分。初回 Cron はスナップショット保存のみで通知なし） (9) 端末間同期 = Cloudflare D1 `apollo-ipo-sync`（database_id 4fb3e1b9-193b-49e7-a480-fc59b6e3c6a2、binding SYNC_DB、`migrations/0001_sync.sql`、ローカル・本番とも適用済み）＋同期キー（32文字、SHA-256 のみ保存、localStorage `ipo-analyzer:sync:v1`）。`/api/sync` GET/PUT。`SyncAutoRunner` を `src/app/layout.tsx` に配置済み
- [検証済み] `public/data/ipos.enriched.json` は 191 件（2024〜2026）。統計の母数: 直近3年／全期間（2015年〜）を詳細ページの Segmented で切替。JPX 発見銘柄の insufficient は 11 件（96ut に記事が無いホールディングス化上場等）
- [検証済み] `.env`（gitignore）に VAPID 3 件。`.dev.vars` は `.env` のコピー（gitignore）。`.env.example` はコミット済み（`.gitignore` に `!.env.example`）
- [検証済み] 検証レポート: `scratch/backtest/report-phase2.md`（BB参加スコア初期重み）、`report-phase3.md`（要因追加・確率モデル）、`report-phase3-events.md`。設計書: `scratch/phase2/design.md`、コンテキスト `scratch/phase2/context.md` `scratch/phase3/context.md`
- [検証済み] ローカル `npm run preview` で前回プレビューの Service Worker が古い HTML をキャッシュしていると ChunkLoadError／React #418 が出る。SW を unregister＋caches.delete すれば正常（本番はネットワーク優先なのでオンライン時は起きない）
- [検証済み] 本人裁定: 完全無料（有料 Cloudflare 機能・App Store・独自ドメイン不可）。TypeSafe の Jev は使わない。M1 夜間ジョブは Wi-Fi 復旧後。前セッション（local_8187ca60…）のアーカイブは分類器にブロックされ未実施（手動で）

## 却下した選択肢と理由

- Jev（TypeSafe / Cloudflare Workers AI `typesafe/jev`）の利用 — 開発を速くする道具ではなく、Workers AI 無料枠の対象か不明。本人裁定で不採用
- Cloudflare Access による同期の認証 — Zero Trust はカード登録が要るため「完全無料」と矛盾。同期キー方式にした
- 幹事団社数・同週上場件数のスコア採用 — Spearman +0.01／+0.06、年別で向きが安定せず不採用（確率モデルの特徴量には含む）
- BB参加スコアの地合い項目を「直近IPO」で置換 — 置換 +0.600 と追加 +0.604 でほぼ同じ。手動設定と需給スコアで共有している既存項目を残し、直近IPOを追加
- `@pushforge/builder` — 出力が旧ドラフト（aesgcm）で RFC8291 ではない。自前実装（依存追加ゼロ）
- 初回決算イベントの表示 — 母数 3 件で判断不能。過去の決算日をバックフィルするまで保留

## 未解決

- GitHub push・PR 未作成（本人指示待ち）
- 上場済み銘柄の `firstEarningsDate` が無いため初回決算イベントの検証ができない
- `EnrichedInfo.tsx` の出典 URL リンクが 375px で親要素にクリップされる（横スクロールは発生しない。既存・軽微）
- 実機（iPhone）での Web Push 実配信は未確認

## 次の一手

1. 本人が「push して」と言ったら: `git push -u origin feat/mobile-app` → PR（`git diff main...HEAD` で全体を確認してサマリ作成、テストプラン付き。main 直 push・force push 禁止）
2. Wi-Fi 復旧後: M1 夜間ジョブ（`m1-ops` Skill）に `npm run update:data && npm run enrich:data && npm run deploy` を登録（deploy は本番反映なので登録前に本人確認）
3. 初回決算イベント: `scripts/updater/main.ts` で上場済み銘柄の過去決算日を yahoo-finance2 の `quoteSummary(calendarEvents/earningsHistory)` から埋め、`scratch/backtest/event_backtest.py` を再実行
4. 任意: `src/components/detail/EnrichedInfo.tsx` の出典 URL を `break-all` から短縮表示（ドメイン＋記事番号）へ

## 触ったファイル

- /Users/kazukiyoshida/ipo-analyzer/scratch/phase2/{context.md,design.md,design-*.md,integration-requests.md} (編集)
- /Users/kazukiyoshida/ipo-analyzer/scratch/phase3/context.md (編集)
- /Users/kazukiyoshida/ipo-analyzer/src/** （Phase 2/3 の新規・編集。git log c59b778 / 5b53e3c を参照）
- /Users/kazukiyoshida/ipo-analyzer/scripts/enrich/** (新規・編集)
- /Users/kazukiyoshida/ipo-analyzer/worker/** (新規)
- /Users/kazukiyoshida/ipo-analyzer/migrations/0001_sync.sql (新規)
- /Users/kazukiyoshida/ipo-analyzer/public/data/{ipos.enriched.json,ipos.history.json,event-stats.json} (新規)
- /Users/kazukiyoshida/ipo-analyzer/{wrangler.jsonc,package.json,.gitignore,README.md,.env.example,.claude/launch.json} (編集)
- /Users/kazukiyoshida/ipo-analyzer/scratch/backtest/{recalibrate_bb.py,recalibrate_bb_v2.py,event_backtest.py,fetch_prices.py,report-phase2.md,report-phase3.md,report-phase3-events.md} (編集)
