# HANDOFF: Apollo IPO（スマホ版）Phase 2 — 投資家判断に必要な情報の拡充

作成日時: 2026-09-25 17:19
作成元セッション: ipo-analyzer / /Users/kazukiyoshida/ipo-analyzer
作成元セッションID: local_8187ca60-0326-4595-bfe7-6f87583c6f29

## 今やっていること

Streamlit版「Apollo IPO」をスマホファーストの Next.js PWA として作り直し、Cloudflare Workers に公開するところまで完了した。
次は本人の要望「投資家として判断に必要な情報を盛り込んだ最高のアプリにしたい」に応える Phase 2（データ拡充・実証統計・BB戦略・イベント通知）を進める。

## 確定した事実

- [検証済み] 公開URL: https://apollo-ipo.zukky-yoshida.workers.dev （Cloudflare Workers、Worker名 `apollo-ipo`、アカウントは wrangler にログイン済み。`npm run deploy` で再デプロイできる。バージョン 6d85196e…）
- [検証済み] ブランチ `feat/mobile-app`（`feat/nextjs-mvp` から分岐）。コミット: 756f784（7/15 WIP）→ bcc6904（スマホ版作り直し）→ e61877d（レビュー修正）→ d47ae02（Cloudflare 設定）→ 20a496f（価格カード修正）。**GitHub へは未 push**（本人指示待ち。remote は origin=zukkyyoshida-arch/ipo-analyzer、main のみ存在）
- [検証済み] 技術構成: Next.js 16.2.10 / App Router / TypeScript strict / Tailwind v4（トークンは `src/app/globals.css`、`bg-surface` `text-muted` `text-accent` 等）/ vitest 154件全通過 / lint 0 / build 成功（191ページ、`/ipo/[code]` は SSG 181件）
- [検証済み] 画面: ボトムタブ5つ（`/` ホーム, `/ipos` 銘柄, `/screener`, `/bb`, `/settings`）＋ `/ipo/[code]` 詳細 ＋ `/offline`。設計書は `scratch/mobile-design.md`（§7 にファイル分担、§8 に納品ゲート）
- [検証済み] PWA: `src/app/manifest.ts`、`public/sw.js`（手書き、network-first、/api 非キャッシュ）、`src/components/pwa/RegisterSw.tsx`（production のみ登録）、アイコン `public/icons/*`。375px/1280px で横はみ出し 0、ボトムタブ高 57px、aria-current 付与を DOM 計測で確認
- [検証済み] Capacitor: `capacitor.config.ts`（appId `com.zukky.apolloipo`、`CAP_SERVER_URL` があれば server.url）、scripts `cap:sync/cap:ios/cap:android`。`npx cap add ios/android` は未実行
- [検証済み] Cloudflare: `wrangler.jsonc` + `open-next.config.ts`（`@opennextjs/cloudflare` 1.20.6、Static Assets incremental cache＝無料枠・ISR の時間再検証なし）。ホームは `dynamic = "force-dynamic"`。**データ更新（`npm run update:data`）の反映には再デプロイが必要**。yahoo-finance2 は `nodejs_compat` で動作（`/api/quote/618A` が本番で 200・JSON 返却）
- [検証済み] データ: `public/data/ipos.base.json` 157件（`scratch/backtest/data/ipo_list.csv`+`fundamentals.csv` の実データ169件から地方市場12件を除外し、`scripts/import_backtest_data.py` で生成。冪等）＋ `ipos.auto.json` 134件（JPX 自動発見＋価格）→ マージ後 181件。価格（currentPrice/recentVolume）は直近730日以内の全銘柄 128件で取得済み（`scripts/updater/main.ts` の `expandPriceTargets()`、1件ごと 300ms 待機、所要 約2分）
- [検証済み] JPX 由来の上場予定銘柄（2026-08〜10 の約24件）は名前・市場・上場日・価格しか無い＝**BB期間・仮条件・公開価格・吸収金額・幹事・VC・業績が全て未取得**。UI は「基本情報 未取得」チップと「未取得」表示で正直に出している。ホーム KPI「直近90日 初値騰落率平均」の母数が 2件しか無いのもこのため
- [検証済み] `src/lib/completeness.ts`（`assessCompleteness` → full/partial/insufficient）でデータ欠損を判定し、insufficient の銘柄はスコアを出さない
- [検証済み] スクリーナーのプリセット: 「高成長×流動性」（売上成長≥30%×直近出来高≥50万株×現在値≥初値）＝バックテスト（`scratch/backtest/report.md`）で唯一プラスだった入口条件、現在 5件一致。「BB参加候補」「ウォッチ中」。逆張り系は不採用
- [検証済み] 文言規律: src 配下に「買い／推奨／おすすめ／お宝／必勝／爆益／テンバガー／勝てる／儲か」は 0 件（grep）。免責は実データ前提の文に更新済み
- [検証済み] localStorage キー（互換維持のため変更禁止）: `ipo-analyzer:settings:v2` `ipo-analyzer:watchlist:v1` `ipo-analyzer:bb:v1` `ipo-analyzer:notes:v1` `ipo-analyzer:theme:v1`
- [検証済み] `scratch/backtest/`（Python ハーネス: rules.py / backtest.py / data/）は再利用可能。新ルールは実装前にここで検証する運用（2026-07-15 本人依頼の経緯）

## 却下した選択肢と理由

- Expo / React Native / Flutter への移行 — 既存 Next.js 資産（スコア純関数・updater・テスト）が流用できず二重管理になる。Capacitor ラッパー方式で十分
- Serwist / next-pwa — Next 16 + Turbopack との互換情報が食い違い。手書き SW の方が確実
- ISR に R2/KV/Durable Objects — DO キューは有料、R2 は追加セットアップ。個人利用は「更新→再デプロイ」で足りる
- vinext（Cloudflare の新推奨） — ベータ。安定後に再検討
- Streamlit 版の X センチメント・Gemini/Ollama 要約・架空銘柄・3銘柄固定プレIPO診断 — 捏造値／助言リスク／陳腐化のため持ち込まない
- 旧ファイル（Header.tsx 等）の削除 — 本人裁定で削除は確認必須。未使用のまま残置（`src/data/ipos.json` も死ファイル、削除は本人確認後）

## 未解決

- 319A（技術承継機構）の公開価格/初値: 旧手動値 1200/1550 と CSV 値 2000/2700 が食い違い。CSV 優先で採用中
  - 再現手順: `python3 scripts/import_backtest_data.py` の stderr に食い違いログが出る
  - 期待: 一次情報（目論見書・kabutan 等）で確定 ／ 実際: 未確認
- 260A の価格取得スキップ（Yahoo: No data found）。上場廃止か市場違いか未確認
- 上場済で申込記録なしの詳細ページに「BB申込状況」が折りたたみで残る（仕様どおりだが冗長）
- GitHub 未 push・PR 未作成（本人指示待ち）。Workers Builds（push で自動デプロイ）も未設定
- `scratch/streamlit-app.py`（旧 app.py の書き出し）と `scratch/icon-maskable-src.svg` が未追跡のまま（コミット不要。削除は本人確認後）

## 次の一手（Phase 2 の優先順。1〜3 が本丸）

1. **上場予定銘柄の完全データ化（第2データソース）** — `scripts/updater/ipoinfo.ts` を新設し、IPO 情報サイト（kabutan の IPO ページ／ipokiso／96ut のいずれか。`scratch/backtest/data/fundamentals.csv` の source 列に実績 URL あり）から 1銘柄1ページ・1秒間隔・UA 明示で取得: 想定価格／仮条件／公開価格／BB期間／抽選日／購入期間／公募・売出・OA 株数／吸収金額／オファリングレシオ／時価総額／幹事団と配分比率／VC 比率／ロックアップ（日数・1.5倍解除・対象）／大株主／売上・営業利益・成長率／事業内容。出力は新レイヤー `public/data/ipos.enriched.json`（型 `IpoEnriched` を `src/types/data.ts` に追加）にし、`src/lib/merge.ts` を「base（手動）＞ enriched ＞ auto（価格）」の優先順に拡張（`mergeIpos` にテスト追加）。`scripts/updater/main.ts:250` 付近の JPX 発見の直後に呼ぶ。robots.txt と利用規約を確認し、個人利用の範囲で
2. **「類似IPOの初値実績」と統計ページ** — `src/lib/stats/index.ts`（純関数＋テスト）: 吸収金額帯（〜10／10〜30／30〜100／100億〜）×市場×地合いで過去銘柄の初値騰落率の分布（件数・中央値・勝率）、主幹事別の公募割れ率、オファリングレシオ帯別の騰落。詳細ページに「類似IPOの実績（過去 N 件）」カード、`/stats` ページ（スクリーナータブ内のサブタブ）。データは `ipos.base.json` 169件で足りる。文言は「実績分布」「参考情報」に限定
3. **BB参加スコアの再校正** — 2 の統計と `scratch/backtest/` で「吸収金額・OR・仮条件位置・主幹事・VC/ロックアップ・地合い・過密度」の重み初期値を実証データで決め直し、`src/lib/scoring/weights.ts` のプリセット「需給重視」を更新（テスト更新）。report.md の提言①に対応
4. **BB戦略ボード** — `/bb` に「申込先の優先順位」（幹事配分比率×抽選方式×前受金）と口座別の資金拘束合計（同時 BB 期間の重なりを日付で計算）、抽選日・購入期限のカレンダー。`src/data/brokers.ts` に配分を持てるよう `Broker` 型を拡張
5. **イベントカレンダー** — ロックアップ解除日（listingDate+90/180 日、1.5倍条項は現在値≥公開価格×1.5 で判定）、決算発表日（updater 取得済み `firstEarningsDate`）、グロース250 定期入替、大量保有（`.env` の `EDINET_API_KEY` 設定で有効）。ホーム「今後14日の予定」を拡張
6. **プッシュ通知** — Web Push（VAPID）＋ Cloudflare Workers Cron（前日 20:00 に BB 開始／抽選日／購入期限／上場日を通知）。購読情報は Cloudflare KV。iOS はホーム画面追加後のみ受信可。App Store 4.2 対策にもなる
7. **セカンダリー分析の深化** — 詳細ページのチャートを 6ヶ月ローソク＋25日MA＋出来高（自前 SVG、依存追加なし）、公開価格・初値ラインを重ねる。適時開示（TDnet／kabutan 開示ページ）の最新タイトル表示
8. **クラウド同期** — ウォッチ・BB 記録を Cloudflare D1 に保存し iPhone と Mac で共有（Cloudflare Access のメール認証で個人限定）
9. **ネイティブ化** — `npm i -D @capacitor/ios @capacitor/android && npx cap add ios`、`CAP_SERVER_URL=https://apollo-ipo.zukky-yoshida.workers.dev`。6 の通知が入ってから
10. 運用: M1 の夜間ジョブに `npm run update:data && npm run deploy` を登録（`m1-ops` Skill）。GitHub push → PR → Workers Builds 連携は本人指示後

## 触ったファイル

- /Users/kazukiyoshida/ipo-analyzer/scratch/mobile-design.md（設計書・編集）
- /Users/kazukiyoshida/ipo-analyzer/scratch/cloudflare-plan.md（Cloudflare 調査）
- /Users/kazukiyoshida/ipo-analyzer/scratch/understand-result.json, implement-result.json, review-result.json（Workflow 結果）
- /Users/kazukiyoshida/ipo-analyzer/src/app/**（layout.tsx, page.tsx, ipos/, ipo/[code]/, screener/, bb/, settings/, offline/, api/quote/[code]/, manifest.ts, globals.css）（編集）
- /Users/kazukiyoshida/ipo-analyzer/src/components/**（ui/, nav/, pwa/, home/, ipos/, detail/, screener/, bb/, settings/ ほか既存コンポーネント）（編集）
- /Users/kazukiyoshida/ipo-analyzer/src/lib/{completeness,quote,format,highlights}.ts, src/lib/home/, src/lib/screener/（編集）
- /Users/kazukiyoshida/ipo-analyzer/src/hooks/useTheme.ts（編集）
- /Users/kazukiyoshida/ipo-analyzer/scripts/import_backtest_data.py, scripts/updater/main.ts（編集）
- /Users/kazukiyoshida/ipo-analyzer/public/data/*.json, public/sw.js, public/icons/*, public/apple-touch-icon.png（編集）
- /Users/kazukiyoshida/ipo-analyzer/{wrangler.jsonc, open-next.config.ts, capacitor.config.ts, next.config.ts, eslint.config.mjs, package.json, .gitignore, README.md}（編集）
- /Users/kazukiyoshida/ipo-analyzer/scratch/backtest/report.md, scratch/backtest/data/*.csv（参照）
