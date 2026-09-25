# Apollo IPO Phase 2 設計書（実装確実性・MVP優先 / 2026-09-25）

実装エージェントはこの文書だけを読んで迷わず実装できることを目標にする。判断に迷ったら
「1セッションで確実に動く最小構成」「依存追加ゼロ〜最小」「既存コンポーネントの再利用」
「純関数境界を明確にしテストしやすくする」の4原則で決める。

本文書は `scratch/phase2/context.md`（現状・データソース・本人裁定）と
`scratch/mobile-design.md`（§3 デザイントークン・§6 禁止語・§7 ファイル分担・§8 納品ゲート）
を前提とする。矛盾があれば本文書（Phase 2 固有の指示）を優先する。同フォルダに別レンズの
`design-investor.md`（投資家の意思決定フロー優先）が存在するが、本文書は独立した実装仕様。
どちらか一方を採用する場合は本文書（MVP優先・実装確実性）を使う。

---

## 0. 全体方針

Phase 2 スコープ1〜7（context.md 末尾）を全部カバーする。8〜10（クラウド同期D1・ネイティブ化・
M1夜間ジョブ）は §16 設計メモに将来案として1段落ずつ書くのみで実装しない。

### 依存追加（最小限。この設計書で追加してよいのはこれだけ）
- `@pushforge/builder`（Web Push VAPID。ゼロ依存・Web Crypto API のみ使用・Cloudflare Workers 公式対応。§6 参照）
- Python標準ライブラリのみ（`scripts/fetch_enriched.py` は `urllib.request` + 標準 `html.parser` 系。**BeautifulSoup/requests 等の追加pipインストールはしない**。`scratch/backtest/venv` に既に入っている場合はそれを使ってよいが、新規に依存を増やさない）
- チャートライブラリは入れない（既存 `Sparkline` の隣に自前SVGローソク足コンポーネントを新設）
- 上記以外の npm 依存追加は禁止

### 技術的な結論（詳細は各節）
- データ拡充（§1）: `public/data/ipos.enriched.json` を新設し、`mergeIpos` を `base > enriched > auto` の3層マージに拡張。**新規スクリプトは Python**（`scripts/fetch_enriched.py`）とし、既存の `scripts/updater/*`（TypeScript/tsx）とは独立させる（96ut.com のテーブルパースは正規表現ベースの軽量パースで十分、cheerio 依存を増やす必要はないため。ただし TypeScript 側から見て型さえ合えばよいので、実装エージェントが Python に不安があれば tsx + cheerio で書いても可。**どちらの言語で書くかは実装エージェントの裁量**とし、本設計書は生成される JSON の形だけを固定する）
- Cron + KV + Web Push（§6）: `@opennextjs/cloudflare` が生成する `.open-next/worker.js` の `fetch` ハンドラをラップし、`scheduled` ハンドラを追加する **custom worker** 方式（公式 how-to: https://opennext.js.org/cloudflare/howtos/custom-worker）。`wrangler.jsonc` の `main` をこの custom worker のパスに変更し、`triggers.crons` を追加。KV は無料枠内（読み取り10万/日・書込み1,000/日・1GB）に収まる設計（購読者数が個人利用規模である前提）。Cron Triggers は無料プランで1 Workerあたり最大3本、アカウント全体で5本まで（1分間隔が最短だが実際の起動は数分単位の遅延があり得る点に注意）
- ローソク足（§7）: 依存追加なしの自前SVG。`src/components/ui/Candlestick.tsx` を新設し `PriceCard` から呼ぶ既存の `/api/quote/[code]` の120日分のcloseを使う。ただし始値・高値・安値がAPIに無いため、**API拡張が必要**（§7 で詳細）

---

## 1. データ拡充（`IpoEnriched` レイヤー）

### 1.1 型定義（新規ファイル `src/types/enriched.ts`）

```typescript
// 96ut.com から取得した「補完データ」レイヤー。手動管理の base、updater管理の auto とは
// 別の第3のレイヤーとして扱う。取得元・取得日時を必ず保持し、UIで出典を示せるようにする。

import type { Market } from "@/types/ipo";

/** 1銘柄分の株主情報（大株主・ロックアップ）。 */
export interface EnrichedShareholder {
  name: string;
  shares: number;
  ratioPercent: number;
  /** ロックアップ日数。無指定（空欄）は null。 */
  lockupDays: number | null;
}

/** 引受幹事1社の配分情報。 */
export interface EnrichedUnderwriterAllocation {
  name: string;
  /** 割当株数。取得不能（"-"表記）は null。 */
  shares: number | null;
  /** 割当比率(%)。取得不能は null。 */
  ratioPercent: number | null;
}

/** 業績テーブル1期分。 */
export interface EnrichedFinancialPeriod {
  /** 決算期（例: "2025/09"） */
  period: string;
  revenue: number | null;
  revenueGrowthPercent: number | null;
  operatingProfit: number | null;
  operatingProfitGrowthPercent: number | null;
  netProfit: number | null;
  netProfitGrowthPercent: number | null;
}

/**
 * 96ut.com から取得した1銘柄分の補完データ。
 * すべてのフィールドは「取得できたものだけ」入る（取得不能は null / 空配列）。
 * code は必須で base/auto と共通のキー。
 */
export interface IpoEnriched {
  code: string;
  /** 出典URL（例: "https://kabu.96ut.com/article/ipo/2026035/"）。UIの出典表示に使う。 */
  sourceUrl: string;
  /** 取得日時（ISO）。 */
  fetchedAt: string;

  // --- 日程（base の bbPeriod 等と同じ形。base が空の場合のみ merge.ts が採用） ---
  priceRangeDecisionDate: string | null;
  bbPeriod: { start: string; end: string } | null;
  offeringPriceDecisionDate: string | null;
  purchasePeriod: { start: string; end: string } | null;
  listingDate: string | null;

  // --- 基本情報 ---
  publicShares: number | null;
  saleShares: number | null;
  overAllotment: number | null;
  issuedShares: number | null;
  offeringRatioPercent: number | null;
  assumedPrice: number | null;
  /** 仮条件価格。未発表なら null。 */
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  /** 公募価格。未決定なら null。 */
  offeringPrice: number | null;
  absorptionAmountOku: number | null;
  marketCapOku: number | null;

  // --- 引受 ---
  leadUnderwriter: string | null;
  underwriterAllocations: EnrichedUnderwriterAllocation[];

  // --- 会社概要 ---
  location: string | null;
  establishedDate: string | null;
  employeeCount: number | null;
  auditor: string | null;
  market: Market | null;
  sector: string | null;
  businessDescription: string | null;

  // --- 業績 ---
  financials: EnrichedFinancialPeriod[];
  epsLatest: number | null;
  bpsLatest: number | null;
  dividendLatest: number | null;

  // --- 株主・VC・ロックアップ ---
  shareholders: EnrichedShareholder[];
  /** 既存株主総計の対象株数（ロックアップ対象）。 */
  lockupTargetShares: number | null;
  /** 既存株主のロックアップカバー率(%)。 */
  lockupCoveragePercent: number | null;
  /** VC推定保有株数（上場前）。 */
  vcHoldingShares: number | null;
  /** VC推定保有比率(%)。 */
  vcHoldingRatioPercent: number | null;
  /** VC保有のうちロックアップ対象株数。 */
  vcLockupShares: number | null;

  // --- SO ---
  stockOptionTotalShares: number | null;
}
```

**取り込まない項目**（context.md 本人裁定）: 「初値予想」「BB参加姿勢」「直前予想」「新規承認時の第一印象」「スタンス評価」など他サイトの主観評価。パース対象のテーブルから該当セクションは読み飛ばす。

### 1.2 取得スクリプト（新規 `scripts/fetch_enriched.py` または `scripts/updater/enriched.ts` — 実装エージェントの裁量。以下は仕様。担当: data タスク）

**入力**: 対象コード一覧（base 157件全部 + auto の discovered 銘柄）。96ut の記事番号は `2026035` のような「年+連番」で銘柄コードとの対応が事前には分からないため、以下の発見フローを使う。

1. `https://kabu.96ut.com/post-sitemap.xml` 〜 `post-sitemap6.xml`（存在する分だけ、404は404で停止し次の番号へは進まない = 前提: サイトマップ番号は連番で埋まっている。取得できたものだけ使う）を1 req/秒で取得し、`<loc>` から `article/ipo/(\d+)/` のURL一覧を得る
2. 各記事URLを1 req/秒で取得し、ページ内の `[XXXX]` 形式（例: `[648A]`）から銘柄コードを抽出してマッチング。マッチしないページはスキップ
3. 取得したHTMLを §1.1 の構造にパースし、`IpoEnriched` の配列を組み立てる
4. 出力: `public/data/ipos.enriched.json`（既存コードは新しい取得結果で丸ごと置き換え。過去に取れていて今回取れなかった銘柄は「前回値を保持」ではなく**削除せず前回のレコードをそのまま残す**＝ファイルはコードをキーにした差分マージで書き込む。理由: 96ut側の一時的な構造変化やタイムアウトで丸ごと空になる事故を避けるため）

**パース規則（HTML構造は `scratch/phase2/fixtures/*.html` の3サンプルで検証済み）**:
- ページはタグを除去した後のプレーンテキストを行区切りで走査する方式で十分（fixtureで確認した通り `<table class="kuro">` 内の `<tr><th>ラベル</th><td>値</td></tr>` 構造。cheerioを使う場合は `table.kuro tr` を走査し `th`/`td` のペアでラベル→値の辞書を作る）
- 日付は `2026/09/29 (火)` → `2026-09-29` に変換（`scripts/updater/jpx.ts` の `parseListingDate` と同じ正規表現パターンを流用可）
- 金額・株数は `,` 除去して数値化。`未定`/`未発表`/`-` は null
- 「幹事団と割当」テーブルは1行目の主幹事を含めて全行を `underwriterAllocations` に入れる（`割当数`/`割当(%)`が `-` なら null）
- 「上場前既存株主の状況」テーブルは `氏名`/`株数(株)`/`割合(%)`/`ロックアップ` の4列。`既存株主総計(N)` 行は `shareholders` に含めず、`lockupTargetShares`/`lockupCoveragePercent` に転記（`対象 5,615,000株` `カバー率 100.00%` の形式をパース）
- 「VC推定保有」行は `VC推定保有(N)（内ロックアップ）` の直後に `上場前：X株` `売出後：Y株` `Z株(W%)` の3値が並ぶ。`vcHoldingShares`=上場前の値、`vcLockupShares`=内ロックアップの値（3値目の括弧前の株数）、`vcHoldingRatioPercent`=3値目の括弧内%
- 業績テーブルは「1株あたりに基づく指標」の直前までが売上/利益テーブル。決算期ごとに `EnrichedFinancialPeriod` を作る
- 取得規律（context.md §「第2データソースの調査結果」を厳守）: 1 req/秒以上の間隔、UA明示（例: `Mozilla/5.0 (compatible; ApolloIPOBot/1.0; personal use)`）、タイムアウト20秒、失敗はスキップして続行、robots.txt遵守（`/wp-admin/` のみDisallow）

**再実行方法**: `npm run fetch:enriched`（package.json に追加。中身は `python3 scripts/fetch_enriched.py` または `tsx scripts/updater/enriched.ts`）。updater本体（`update:data`）とは別スクリプト・別npmスクリプトにする（96utは1回のフルクロールに3〜4分かかり、JPX/Yahoo Financeの更新頻度と合わせる必要がないため）。

### 1.3 `merge.ts` の拡張（担当: **integration** タスクのみが触る。§14 参照）

`src/lib/merge.ts` に第3引数 `enriched: IpoEnriched[]` を追加し、優先順位を **base（手動）＞ enriched（96ut）＞ auto（JPX/Yahoo）** にする。

```typescript
// mergeIpos のシグネチャ変更（既存呼び出し元を全て更新）
export function mergeIpos(
  base: IpoBase[],
  enriched: IpoEnriched[],
  auto: IpoAuto[],
): Ipo[]
```

マージ規則の純関数を新設: `mergeEnriched(ipo: Ipo, enriched: IpoEnriched | undefined): Ipo`。
- **base側の値が「未取得を示す既定値」のときだけ enriched で埋める**。既定値の判定は `src/lib/completeness.ts` の判定ロジックと整合させる:
  - `bbPeriod.start === "" && bbPeriod.end === ""` → enriched.bbPeriod があれば採用
  - `allotmentDate === ""` → enriched.offeringPriceDecisionDate があれば採用（96ut の「公募価格決定」日＝抽選日相当。context.md に明記の対応）
  - `purchasePeriod` 同様
  - `offeringPrice === null` → enriched.offeringPrice があれば採用
  - `priceRange.low === 0 && priceRange.high === 0` → enriched の priceRangeLow/High があれば採用（無ければ assumedPrice を low=high として採用）
  - `publicShares === 0` → enriched.publicShares
  - `saleShares === 0` → enriched.saleShares
  - `overAllotment === 0` → enriched.overAllotment
  - `absorptionAmount === 0` → enriched.absorptionAmountOku
  - `offeringRatio === 0` → enriched.offeringRatioPercent
  - `marketCap === 0` → enriched.marketCapOku
  - `vcRatio === 0` → enriched.vcHoldingRatioPercent
  - `lockup.days === 0` → enriched.shareholders の最頻値（`hasPriceRelease` は判定不能なので `false` のまま。1.5倍解除条項は96utのテキストに明示が無いため据え置き）。`lockup.coverage` は enriched.lockupCoveragePercent
  - `leadUnderwriter === ""` → enriched.leadUnderwriter
  - `underwriters.length === 0` → enriched.underwriterAllocations の name 配列
  - `financials.revenue === 0` → enriched.financials の最新期の revenue（百万円換算: 96utは千円/百万円混在表記のため、**桁数から自動判定**: 値が10万未満なら百万円単位とみなしそのまま、10万以上なら千円とみなし1000で割る。この判定ロジックは `normalizeToMillionYen(value: number): number` として純関数化しテストで固定する）
  - `financials.revenueGrowth === 0` → enriched 最新期の revenueGrowthPercent
  - `financials.operatingProfit === 0` → enriched 最新期の operatingProfit（同じ単位正規化）
  - `financials.isProfitable` → enriched 最新期の operatingProfit > 0 で上書き（既定値 false のときのみ）
  - `sector === ""` → enriched.sector or businessDescription から先頭一部を採用（任意。無理に作らなくてよい。空のままでも可）
  - `description === ""` → enriched.businessDescription
- **base側に既に値がある項目は enriched で上書きしない**（手動優先の原則を維持）
- `similarIpoCodes` はこのマージでは扱わない（§2 で別途）
- `IpoEnriched` 固有で `Ipo` 型に対応フィールドが無いもの（`epsLatest`/`bpsLatest`/`dividendLatest`/`employeeCount`/`auditor`/`location`/`establishedDate`/`shareholders`/`sourceUrl`/`fetchedAt` 等）は **Ipo 型を拡張しない**（型肥大化を避ける）。詳細ページで出典表示や株主一覧を出したい場合は `IpoDetailClient` が `enriched` を別途 props で受け取る設計にする（§1.4）

新規テストファイル: `src/lib/merge.enriched.test.ts`（既存 `merge.test.ts` があれば見て命名を合わせる。無ければ新設）。境界値: 全項目未取得のbase×enrichedあり→全部埋まる、base既存値あり→上書きされない、enrichedも無い→base既定値のまま。

### 1.4 詳細ページへの `enriched` 受け渡し（担当: **integration**）

`src/lib/repository.ts` に `getEnrichedByCode(code: string): Promise<IpoEnriched | undefined>` を追加。`loadIpoData()` を拡張して enriched も読み込み、`getAllIpos`/`getIpoByCode` の返す `Ipo` は上記マージ済みのものを使う一方、詳細ページ (`src/app/ipo/[code]/page.tsx`) は **追加で** `getEnrichedByCode(code)` を呼んで `IpoDetailClient` に `enriched?: IpoEnriched` として渡す（出典表示・大株主一覧・SO情報など Ipo 型に無い情報の表示用）。`enriched` が undefined でも `IpoDetailClient` は落ちない（該当セクションを非表示にする）。

`public/data/ipos.enriched.json` が存在しない/空配列でもビルド・実行が壊れないこと（`readJson` のフォールバックと同じパターンで `[]` を既定値にする）。

---

## 2. 類似IPO実績統計

### 2.1 純関数（新規 `src/lib/stats/index.ts`。担当: **新規タスク `stats`**。既存ファイルは触らない）

```typescript
import type { Ipo, Market } from "@/types/ipo";

/** 吸収金額帯の区分。scoring/items.ts の scoreAbsorption と同じ閾値に揃える。 */
export type AbsorptionBucket = "under10" | "10to30" | "30to100" | "100to500" | "over500";

export function classifyAbsorptionBucket(absorptionAmount: number): AbsorptionBucket;

/** オファリングレシオ帯の区分。 */
export type OfferingRatioBucket = "under10" | "10to20" | "20to30" | "30to50" | "over50";

export function classifyOfferingRatioBucket(offeringRatio: number): OfferingRatioBucket;

/** 分布統計の結果。 */
export interface ReturnDistribution {
  /** 母数（初値騰落率が算出できた銘柄数）。 */
  sampleCount: number;
  /** 平均(%)。母数0ならnull。 */
  mean: number | null;
  /** 中央値(%)。母数0ならnull。 */
  median: number | null;
  /** 公募割れ率(%)。母数0ならnull。 */
  breakEvenRate: number | null;
  /** 最大・最小(%)。母数0ならnull。 */
  max: number | null;
  min: number | null;
}

/**
 * 初値騰落率が算出できる銘柄（initialPrice・offeringPrice 両方あり）の配列から分布統計を作る。
 * 空配列なら全項目 null（sampleCount=0）を返す。
 */
export function computeReturnDistribution(ipos: Ipo[]): ReturnDistribution;

/** 吸収金額帯 × 市場 でグルーピングした分布。 */
export function distributionByAbsorptionAndMarket(
  ipos: Ipo[],
): Map<`${AbsorptionBucket}:${Market}`, ReturnDistribution>;

/** 主幹事別の公募割れ率ランキング（サンプル数2件未満は除外）。 */
export interface UnderwriterBreakEvenStat {
  underwriter: string;
  sampleCount: number;
  breakEvenRate: number;
  meanReturn: number;
}
export function underwriterBreakEvenStats(
  ipos: Ipo[],
  minSample?: number, // 既定 2
): UnderwriterBreakEvenStat[];

/** オファリングレシオ帯別の分布。 */
export function distributionByOfferingRatio(
  ipos: Ipo[],
): Map<OfferingRatioBucket, ReturnDistribution>;

/**
 * 指定銘柄と「同じ吸収金額帯 × 同じ市場」の上場済み銘柄群（自身除く）から分布を計算する。
 * 詳細ページの「類似条件の実績」セクションで使う。
 */
export function similarConditionDistribution(
  target: Ipo,
  allIpos: Ipo[],
): ReturnDistribution;
```

テスト: `src/lib/stats/index.test.ts`。境界値（母数0、境界値ちょうど、負の騰落率含む中央値の偶数/奇数件数）を必ずカバー。

### 2.2 UI（詳細ページ・スクリーナー双方から利用）

- **詳細ページ**: 新規セクション `src/components/detail/SimilarStats.tsx`（担当: detail）。`Section title="類似条件の実績分布"`。`similarConditionDistribution(ipo, allIpos)` を呼び、`KpiTile` 4枚（母数／平均／中央値／公募割れ率）を横並びで表示。母数が3件未満なら `EmptyState title="類似条件の実績データが不足しています"` を出す（統計的信頼性が低いため出さない）。既存の `SimilarIpos`（similarIpoCodes ベースの個別銘柄一覧）とは別セクションとして両方残す（similarIpoCodes は手動指定なので引き続き使う）
- **設計メモとしてのみ**: ホーム・スクリーナーへの分布表示は必須要件に入れない（MVPでは詳細ページのみ）。時間が余れば `/screener` のプリセット説明文に「過去実績: 平均+X% 母数N件」を追記できるが、これは任意拡張（受け入れ基準には含めない）

---

## 3. BB参加スコアの再校正

### 3.1 実証の位置づけ

新規スコア項目を追加する前に、`scratch/backtest/report.md` に効くと分かった要因（吸収金額・オファリングレシオ・主幹事別公募割れ率・仮条件上限決定・ロックアップ・地合い）は**既に** `src/lib/scoring/items.ts` の既存9項目（absorption/market/theme/vcLockup/offeringStructure/underwriter/sentiment/schedule/downside）でほぼカバーされている。「BB参加スコア」を全く新しい軸として作るのではなく、**既存の需給スコアをそのまま「BB参加スコア」の実体として扱い、表示ラベルとプリセット重みだけ調整する**方針にする（依存の少ない安全な変更）。

### 3.2 変更内容（担当: 既存 `src/lib/scoring/*` は共有・読み取り専用ファイルだが、**このタスクに限り scoring/weights.ts のプリセット値のみ integration タスクが変更してよい**。files/keys等の型は変更しない）

- `WEIGHT_PRESETS.supplyDemand`（需給重視プリセット）の重みを、`scratch/backtest/report.md` の効く要因の強さに応じて再配分する。具体的な数値変更は実装時に以下の根拠で決める:
  - 吸収金額（`absorption`）とオファリングレシオを含む `offeringStructure`: 現行4/3 → **5/4**（レポートで最も効くとされた2要因なので最大重みにする）
  - `vcLockup`: 現行4 → 4のまま（ロックアップも効くとレポートにあるため維持）
  - `underwriter`: 現行2 → **3**（主幹事別公募割れ率が効くというレポート結果を反映。ユーザー設定の係数と重みの両方が効くようにする）
  - `sentiment`: 現行3 → 3のまま
  - `theme`/`market`/`schedule`/`downside`: 現行維持
  - `growth`/`valuation`（ファンダ軸）: 需給重視プリセットでは現行1のまま変更しない
  - **この数値は実装時に `scratch/backtest/` のスクリプトで再バックテストし、市場平均超過が改善するか確認してから確定する**（本人裁定「新ルール・重みは実装前にscratch/backtestで実証する」を満たすため）。バックテスト方法: `scratch/backtest/backtest.py` に新しい重みプリセットでのスコア降順上位Nの20日後リターンを既存コードと同じ手法（ウォークフォワード）で計算し、`report.md` に追記する形で `scratch/backtest/report-phase2-weights.md` を新規作成し結果を記録する
  - **バックテストで改善しない場合は重み変更を行わず、既存プリセットのまま「BB参加スコア」という表示ラベルの新設のみに留める**（安全側に倒す）
- 表示ラベルの追加: `src/lib/scoring/weights.ts` の `WEIGHT_PRESET_LABELS.supplyDemand` を `"需給重視"` から `"BB参加スコア（需給重視）"` に変更、または `ScoreGauges`（`src/components/detail/ScoreGauges.tsx`、担当: detail）の「需給」ラベルの下に小さく「＝BB参加スコア」という注記を追加する形でもよい（実装エージェントが見た目のバランスで選ぶ）。「参加スコア」の語自体は本文書冒頭§0の禁止語10語のいずれにも一致しないが、実装後に必ず禁止語grepで確認すること

### 3.3 受け入れ基準
- `scratch/backtest/report-phase2-weights.md` が存在し、新重みプリセットでの検証結果（改善したか否か）が記録されている
- 重みを変更した場合、`src/lib/scoring/weights.test.ts`（既存があれば）または新規テストで新しい重み合計・プリセット妥当性を検証
- 改善しなかった場合はプリセット数値を変更せず、その旨を `scratch/backtest/report-phase2-weights.md` に明記

---

## 4. BB戦略ボード

### 4.1 申込優先順位の純関数（新規 `src/lib/bb/priority.ts`。担当: 新規タスク `bb-strategy`。既存 `src/components/bb/*` `src/components/BbManagerClient.tsx` は bb タスクの担当のため、この純関数ファイルのみ新設して bb タスクから呼んでもらう形にする。ファイル境界を明確にするため `src/lib/bb/` ディレクトリは新規に切る）

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";

/** 1銘柄×1証券会社の申込優先順位スコアリング結果。 */
export interface BbPriorityEntry {
  broker: Broker;
  /** 幹事内での立場。主幹事なら "lead"、引受幹事なら "member"、非シンジケートなら "none"。 */
  role: "lead" | "member" | "none";
  /** 優先度スコア（大きいほど優先）。相対比較用で絶対値に意味はない。 */
  priorityScore: number;
  /** スコアの根拠（UI表示用、日本語）。 */
  reason: string;
}

/**
 * 1銘柄について、証券会社ごとの申込優先順位を算出する。
 * 優先度の根拠（すべて客観的な構造要因。的中率等の予測は行わない）:
 *   - 主幹事(lead): +3 / 引受幹事(member): +1 / 非シンジケート(none): 0
 *   - 抽選方式 equal（完全平等）: +2 / proportional（比例）: +1 /
 *     stage（ステージ）・point（ポイント）: 0（資金力・実績依存のため中立）
 *   - 前受金不要（requiresDeposit=false）: +1（資金拘束が無いため申込みやすい）
 * 並びは priorityScore 降順。同点は broker.name の五十音順（Array.sort の既定比較）。
 */
export function rankBrokersForIpo(
  ipo: Ipo,
  brokers: Broker[],
): BbPriorityEntry[];
```

テスト: `src/lib/bb/priority.test.ts`。主幹事×equal×前受金不要が最高スコアになること、非シンジケート×stageが最低になること等を検証。

### 4.2 資金拘束カレンダー（期間の重なり検出。新規 `src/lib/bb/lockCalendar.ts`。担当: bb-strategy）

```typescript
import type { Ipo } from "@/types/ipo";
import type { BbState } from "@/types/userData";
import type { Broker } from "@/types/broker";

/** 1件の資金拘束期間。 */
export interface LockPeriod {
  ipoCode: string;
  ipoName: string;
  brokerId: string;
  brokerName: string;
  /** 拘束開始日（BB期間開始）。 */
  start: string;
  /** 拘束終了日（抽選日。抽選日不明なら購入期間終了、それも無ければBB期間終了）。 */
  end: string;
  /** 拘束金額目安（円）。src/lib/format.ts の estimatedLockAmount と同じ計算。 */
  amount: number;
}

/**
 * BbState の中で status が "applied" または "won" の全エントリから資金拘束期間を洗い出す。
 * BB期間・抽選日が空文字（未取得）の銘柄は対象から除外する（期間が組めないため）。
 */
export function extractLockPeriods(
  ipos: Ipo[],
  bbState: BbState,
  brokers: Broker[],
): LockPeriod[];

/** 2つの日付期間が重なるか（両端含む）。 */
export function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean;

/** 1件の重複組。 */
export interface LockOverlap {
  a: LockPeriod;
  b: LockPeriod;
  /** 重なっている証券会社が同一か（同一口座は資金拘束が合算されるため重要度が高い）。 */
  sameBroker: boolean;
}

/**
 * extractLockPeriods の結果から、期間が重なるペアを全て検出する（O(n^2)、n<50想定で許容）。
 * 同一証券会社の重複を優先して先頭に、異なる証券会社の重複を後ろに並べる。
 */
export function findLockOverlaps(periods: LockPeriod[]): LockOverlap[];
```

テスト: `src/lib/bb/lockCalendar.test.ts`。期間の境界一致（endがstartと同日）は重なりとみなす／みなさないを明記してテストする（**仕様: 境界が同日なら「重なる」とみなす**。BB期間終了日=別銘柄BB期間開始日は資金拘束が同日に両方発生しうるため）。

### 4.3 UI（担当: bb タスク。`src/components/bb/*` と `BbManagerClient.tsx` の範囲内）

- `/bb` 画面に新規セクション「申込優先順位」を追加: 対象銘柄カード（既存 `BbIpoCard`）内、証券会社リストの並び順を `rankBrokersForIpo` の降順に変更し、各行に小さく理由テキスト（`reason`）を表示する任意の折りたたみ（`<details>`、既存 `IpoDetailClient.tsx` のBB申込状況セクションと同じ `<details><summary>` パターンを踏襲）
- 新規セクション「資金拘束カレンダー」: `BbManagerClient.tsx` の `BbSummary` の下に新規コンポーネント `src/components/bb/LockCalendar.tsx` を追加。`extractLockPeriods` → `findLockOverlaps` の結果を使い、重複がある場合は `Chip tone="warn"` で「資金拘束が重なっています」と表示し、重複ペアを `ListRow` で列挙（銘柄名A × 銘柄名B、証券会社、重なる期間）。重複が無い場合はセクション自体を非表示（`EmptyState` は出さない。BB対象銘柄が無いのとは違い「重複なし」は良い状態なのでノイズにしない）
- 抽選日・購入期限のカレンダー表示（context.mdスコープ4後半）は、既存 `EventTimeline`（home用）とは別に BB画面専用の簡易タイムラインとして実装してよいが、**MVPでは既存の `Timeline`（詳細ページ）と `LockCalendar` の一覧表示で要件を満たすとみなし、専用のカレンダーUI（月表示グリッド等）は作らない**（依存追加ゼロ・実装確実性を優先。月表示カレンダーはCSS Grid実装コストが高く1セッションでの安定動作が読みにくいため対象外とする）

---

## 5. イベントカレンダー拡充

### 5.1 純関数拡張（`src/lib/home/index.ts` は home タスクの担当ファイルだが、イベント種別の追加はこの節の仕様に従う。**新規イベント種別の追加のみ**で既存の `upcomingEvents` シグネチャ・戻り値の型を壊さないこと）

`HomeEventKind` に以下を追加:

```typescript
export type HomeEventKind =
  | "bbStart"
  | "allotment"
  | "purchaseStart"
  | "listing"
  | "lockupRelease"        // 追加: ロックアップ解除日
  | "priceReleaseLine"     // 追加: 1.5倍条項の判定対象日（ロックアップ解除日と同日）
  | "earnings"              // 追加: 決算発表日
  | "largeHoldingReport";   // 追加: 大量保有報告書の提出日
```

新規純関数 `src/lib/home/events.ts`（home タスクが新設。`index.ts` からもimportして`upcomingEvents`に合流させる、または `index.ts` に直接追記する形でもよい。**ファイルを分けるか index.ts に足すかは home タスクの裁量**）:

```typescript
import type { Ipo } from "@/types/ipo";

/** 上場済み銘柄のロックアップ解除日（listingDate + lockup.days）。upcoming等は対象外。 */
export function computeLockupReleaseDate(ipo: Ipo): string | null;

/**
 * 1.5倍条項の判定に必要な情報。解除日時点で判定するため、判定自体は
 * 「現在値 ≥ 公開価格×1.5」の比較（表示側で行う）。この関数は判定"対象日"を返すのみ。
 */
export function hasPriceReleaseCondition(ipo: Ipo): boolean; // lockup.hasPriceRelease をそのまま返すラッパ（可読性のため）
```

`upcomingEvents` の候補配列に以下を追加する条件分岐:
- `lockupRelease`: `ipo.status === "listed"` かつ `computeLockupReleaseDate(ipo)` が期間内
- `priceReleaseLine`: `ipo.lockup.hasPriceRelease === true` かつ `lockupRelease` と同日（同じ日付を2つのkindで出す。UIで「ロックアップ解除（1.5倍条項あり）」のように合成表示してもよい。イベント配列としては2件出る前提でテストする）
- `earnings`: `ipo.firstEarningsDate` が期間内（既存フィールドを使う。新規取得ロジック不要）
- `largeHoldingReport`: `ipo.largeHoldingReport?.date` が期間内（既存フィールド）

`EVENT_LABELS` に4種のラベル追加: `lockupRelease: "ロックアップ解除"`, `priceReleaseLine: "1.5倍条項判定日"`, `earnings: "決算発表"`, `largeHoldingReport: "大量保有報告"`。

`kindOrder` 配列（同日の並び順）に新種別を追加: `["bbStart", "allotment", "purchaseStart", "listing", "priceReleaseLine", "lockupRelease", "earnings", "largeHoldingReport"]`。

### 5.2 1.5倍条項の判定表示（詳細ページ。担当: detail）

`src/components/detail/Timeline.tsx` に、上場済み銘柄でロックアップ解除日を過ぎている場合の判定結果行を追加:

```
if (ipo.status === "listed" && ipo.lockup.hasPriceRelease && releaseDate <= today) {
  現在値 >= 公開価格 × 1.5 なら「解除条件 成立（現在値は参考値）」
  そうでなければ「解除条件 未成立」
}
```
ただし Timeline は Server Component から呼ばれる純表示コンポーネントで `today` を持たない。**`todayIso` を props に追加**（`IpoDetailClient` が既に `page.tsx` から受け取っていない場合は、`src/app/ipo/[code]/page.tsx`（**共有ファイル・integration担当**）でサーバー側計算し `IpoDetailClient` へ `todayIso` prop を追加、`IpoDetailClient` から `Timeline` へ中継する）。1.5倍条項の判定には `currentPrice`（静的値。ライブ値はPriceCard側の別state管理のため混在させない。**静的値ベースの参考判定である旨を必ず注記文言に含める**: 「参考情報（静的データ基準）」）。

### 5.3 受け入れ基準
- `upcomingEvents` のテストに新4種別のケースを追加（境界値: listingDate + lockup.days の計算、firstEarningsDate/largeHoldingReportがnullの場合に候補から除外されること）
- ホーム画面 `EventTimeline`（home担当、既存コンポーネントの表示ロジックを変更する必要があれば home タスクが対応。**新種別のkindに対応するアイコン・表示文言の追加のみ**で、コンポーネントの構造は変えない）

---

## 6. プッシュ通知（Web Push VAPID + Workers Cron + KV）

### 6.1 技術選定の根拠

- **ライブラリ**: `@pushforge/builder`（npm、ゼロ依存、Web Crypto API のみで動作、Cloudflare Workers 公式互換）。`buildPushHTTPRequest({ privateJWK, subscription, message })` を呼んで得た `{endpoint, headers, body}` を `fetch()` するだけの薄い設計。Node.js固有API（`crypto`モジュール等）に依存しないため Workers の V8 isolateで動く
- **VAPIDキー生成**: `npx @pushforge/builder vapid` をローカルで1回実行し、生成された公開鍵・秘密鍵を `.env`（ローカル開発）と Cloudflare の Secret（`wrangler secret put VAPID_PRIVATE_KEY_JWK`、本番）に保存する。**秘密鍵はコード・設定ファイルに平文で書かない**（本人裁定）。公開鍵はクライアントJSに埋め込む必要があるため `NEXT_PUBLIC_VAPID_PUBLIC_KEY` として `.env`／Cloudflareの環境変数（Secretではなく通常のvars）に置く
- **Cron**: `@opennextjs/cloudflare` の custom worker 方式（公式 https://opennext.js.org/cloudflare/howtos/custom-worker）。生成される `.open-next/worker.js` の `fetch` ハンドラをそのまま再エクスポートし、`scheduled` ハンドラを追加する薄いラッパーファイルを書き、`wrangler.jsonc` の `main` をそのラッパーに向ける
- **KV**: 購読情報（endpoint + keys）の保存に使う。無料枠（読み取り10万/日・書込み/削除/一覧 各1,000/日・合計1GB）は個人利用規模で十分。`wrangler.jsonc` に `kv_namespaces` を追加（`wrangler kv namespace create apollo-ipo-push-subscriptions` をローカルで実行してIDを取得 → 設定ファイルに反映。**このコマンド実行とCloudflareへのnamespace作成は「本番反映」に類する操作のため、実行前に本人確認を取ること**。設計書としてはコマンドと設定例を示すに留め、実行はしない）

### 6.2 データフロー

```
[クライアント]
  設定画面で「通知を有効にする」タップ
  → Notification.requestPermission()
  → serviceWorker.pushManager.subscribe({ applicationServerKey: VAPID公開鍵 })
  → 得られた PushSubscription を POST /api/push/subscribe に送信

[POST /api/push/subscribe]（新規 src/app/api/push/subscribe/route.ts）
  → KV に subscription を保存（key: subscriptionのendpointのハッシュ、または連番ID）
  → 併せてユーザーの通知設定（どのイベント種別を受け取るか）も保存

[Cron（毎日朝1回、JST 8:00頃 = UTC 23:00）]
  → scheduled ハンドラが起動
  → repository.ts と同じロジックで当日〜翌日のイベント（upcomingEvents の中で
    「明日ちょうど」に該当するもの）を計算
  → KV から全購読者を列挙
  → 各購読者へ @pushforge/builder で通知を送信（該当イベントがある場合のみ）
  → 送信失敗（410 Gone等、購読が失効している）は該当KVエントリを削除
```

### 6.3 型定義（新規 `src/types/push.ts`。担当: 新規タスク `push`）

```typescript
/** ブラウザの PushSubscription をJSONシリアライズした形（標準W3C形式）。 */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** KVに保存する1購読者分のレコード。 */
export interface PushSubscriberRecord {
  subscription: PushSubscriptionJson;
  /** 通知を受け取るイベント種別。既定は全種別。 */
  enabledKinds: PushEventKind[];
  /** 登録日時（ISO）。 */
  createdAt: string;
}

export type PushEventKind =
  | "bbStart"
  | "allotment"
  | "purchaseStart"
  | "listing"
  | "lockupRelease"
  | "earnings";

/** Cronから送るpush通知のペイロード（Service Worker側のpushイベントで受け取る）。 */
export interface PushNotificationPayload {
  title: string;
  body: string;
  /** タップ時に開くURL（相対パス）。 */
  url: string;
}
```

### 6.4 サーバー側実装ファイル一覧（担当: push タスク。新規ファイルのみ、既存ファイルは触らない）

| ファイル | 責務 |
|---|---|
| `src/types/push.ts` | §6.3 の型 |
| `src/lib/push/subscription.ts` | KVへの読み書きヘルパー純関数。`saveSubscriber(kv, id, record)`, `deleteSubscriber(kv, id)`, `listSubscribers(kv)`（`KVNamespace` 型は `@cloudflare/workers-types` 由来。`cloudflare-env.d.ts` の `CloudflareEnv` に `PUSH_SUBSCRIPTIONS: KVNamespace` を追加する必要あり＝ integration タスクが `wrangler.jsonc` 変更後に `npm run cf-typegen` を再実行して型を再生成） |
| `src/lib/push/notify.ts` | `buildNotificationsForDate(ipos: Ipo[], targetDateIso: string): { kind: PushEventKind; ipo: Ipo }[]` — 純関数。翌日ちょうどのイベントを抽出（`upcomingEvents(ipos, todayIso, 1)` を呼んで day=1 のものだけ拾うラッパーでよい）。`buildPayload(kind, ipo): PushNotificationPayload` — 通知文言の組み立て |
| `src/app/api/push/subscribe/route.ts` | POST: リクエストボディ（`PushSubscriptionJson` + `enabledKinds`）を検証しKVに保存。Edge runtime（`export const runtime = "edge"` は Next.js on Cloudflare Workers では不要 — OpenNext は全ルートをWorkers上で動かすため通常のNode runtime指定のままでよい。**ただし `process.env` ではなく Cloudflare bindings 経由でKVにアクセスする必要があるため、`getCloudflareContext()`（`@opennextjs/cloudflare` が提供)を使う**） |
| `src/app/api/push/unsubscribe/route.ts` | POST: endpoint指定でKVから削除 |
| `worker/push-scheduled.ts`（プロジェクトルート直下 `worker/`。**wrangler.jsonc の `main` が指す custom worker 本体**） | `scheduled` ハンドラ。KVから全購読者列挙 → その日の対象銘柄データ取得（同梱の `public/data/*.json` を直接importして`mergeIpos`を呼ぶ。Workers環境からのfetchで自分自身のURLを叩く必要はない）→ `buildNotificationsForDate` → 該当者へ `@pushforge/builder` で送信 → 失敗した購読はKVから削除 |
| `public/sw-push.js` の代わりに既存 `public/sw.js` へ追記（**foundation担当が触る `public/sw.js` に、push タスクが以下の2つの `addEventListener` を追記する。foundationとpushで同一ファイルを触る唯一の例外なので、push タスクは実装順序を foundation の後にする（§14 依存順で明記）**） | `self.addEventListener('push', ...)` で通知表示、`self.addEventListener('notificationclick', ...)` でタップ時に該当URLを開く |

### 6.5 `worker/push-scheduled.ts` の実装形（custom worker。担当: push タスク。integration が `wrangler.jsonc` の `main` をここに向ける）

```typescript
// @opennextjs/cloudflare が生成する fetch ハンドラをラップし、scheduled ハンドラを追加する。
// 公式 how-to: https://opennext.js.org/cloudflare/howtos/custom-worker
// @ts-ignore `.open-next/worker.js` はビルド時に生成される
import { default as nextHandler } from "../.open-next/worker.js";
import { runPushNotifications } from "./run-push-notifications";

export default {
  fetch: nextHandler.fetch,
  async scheduled(
    controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runPushNotifications(env));
  },
} satisfies ExportedHandler<CloudflareEnv>;
```

`worker/run-push-notifications.ts` に実処理（KV列挙・通知送信ロジック）を分離し、**この関数はテスト可能な純関数に近い形にする**（`env.PUSH_SUBSCRIPTIONS` と `env.VAPID_PRIVATE_KEY_JWK` を引数で受け取り、`fetch` はモック可能にする。vitestでのユニットテストは「該当イベントの抽出ロジック」（`buildNotificationsForDate`）だけをテストし、実際のKV/fetch呼び出しはテスト対象外でよい＝ E2E的な検証はデプロイ後の手動確認とする）。

### 6.6 `wrangler.jsonc` 変更（担当: integration。**本番デプロイと同義の変更点を含むため、KV namespace作成コマンドの実行とデプロイは本人確認を得てから行う**。設計としての設定例のみ示す）

```jsonc
{
  "main": "./worker/push-scheduled.ts",  // .open-next/worker.js から変更
  "kv_namespaces": [
    { "binding": "PUSH_SUBSCRIPTIONS", "id": "<wrangler kv namespace createで得たID>" }
  ],
  "triggers": {
    "crons": ["0 23 * * *"]  // 毎日 UTC 23:00 = JST 8:00
  },
  "vars": {
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY": "<公開鍵>"
  }
  // VAPID_PRIVATE_KEY_JWK は `wrangler secret put VAPID_PRIVATE_KEY_JWK` で別途投入（平文でファイルに書かない）
}
```

Cron Triggersは無料プランで1 Workerあたり最大3本・アカウント全体5本まで（出典: Cloudflare公式ドキュメント https://developers.cloudflare.com/workers/configuration/cron-triggers/ および2026年時点の制限情報 https://runhooks.app/blog/cloudflare-workers-cron-triggers-limits/）。1本のみ使用するため問題ない。

### 6.7 クライアント側UI（担当: settings タスク。`src/components/settings/*` の範囲）

`/settings` 画面に新規セクション「プッシュ通知」:
- iOS判定: `navigator.standalone` または `matchMedia('(display-mode: standalone)')` でホーム画面追加済みかを判定する純関数 `isInstalledPwa(): boolean`（`src/lib/pwa/environment.ts` 新設、settings タスクが作成）。iOS Safari（ホーム画面未追加）の場合は「iOSでは、まずホーム画面に追加してください（共有→ホーム画面に追加）」の案内のみ表示しトグルは無効化
- 有効化トグル（`Segmented` または単純なボタン）。押下で `Notification.requestPermission()` → 許可されたら `serviceWorker.ready` → `pushManager.subscribe()` → `/api/push/subscribe` へPOST
- 通知種別の選択（BB開始／抽選／購入期間開始／上場／ロックアップ解除／決算、チェックボックス群。`enabledKinds`）
- 状態表示: 未対応ブラウザ（`'PushManager' in window` が false）では「このブラウザは通知に対応していません」

### 6.8 テスト観点
- `buildNotificationsForDate`: 対象日ちょうどのイベントのみ抽出、複数銘柄・複数種別の混在、対象なしで空配列
- `isInstalledPwa`: モック環境でtrue/false
- サーバー側KV読み書き（`subscription.ts`）はvitestでは環境依存が強いため、**関数シグネチャを `KVNamespace` インターフェース経由にしてモック注入可能にする**ことをテスト容易性の要件とし、モックKVでの単体テストを書く

### 6.9 受け入れ基準
- `npm run build` が custom worker 構成でも成功する（`main` 変更後、`opennextjs-cloudflare build` の出力パスと custom worker の import パスが一致すること）
- ローカルでは `npm run preview`（Workers ローカル実行）で `/api/push/subscribe` にPOSTし、KVに書き込まれることを確認（wrangler devのローカルKVで可）
- **実際のプッシュ通知配信（本番Cron起動）の確認は本番デプロイ後になるため、このセッションでは配線の正しさ（型・ビルド成功・ローカルKVでの書き込み）までを完了基準とし、本番での配信確認は本人が別途行う**

---

## 7. セカンダリー分析の深化（自前SVGローソク足）

### 7.1 `/api/quote/[code]` の拡張（担当: **integration**。共有ファイル `src/app/api/quote/[code]/route.ts` を変更するため）

既存レスポンスの `closes: QuoteClose[]` に `open`/`high`/`low` を追加する（**既存フィールドは削除しない。追加のみ**なので後方互換）:

```typescript
interface QuoteClose {
  date: string;
  open: number | null;   // 追加
  high: number | null;   // 追加
  low: number | null;    // 追加
  close: number;
  volume: number | null;
}
```

`yf.chart()` の戻り値 `q.open`/`q.high`/`q.low` は既に取得できている（`scripts/updater/main.ts` の `fetchChartQuotes` で使用実績あり）ので、`route.ts` 側で単に拾って追加するだけ。`src/lib/quote.ts` の `QuotePoint` 型も同様に拡張（担当: data タスク、既存ファイルなので integration と調整。**このファイルは元々 data タスクの担当だが型変更は integration が窓口になり、data タスクへの変更依頼として `sharedChangeRequests` に記載する運用でもよい。実装エージェントが1人で全部やる場合はそのまま変更してよい**）。

### 7.2 ローソク足コンポーネント（新規 `src/components/ui/Candlestick.tsx`。担当: foundation。`src/components/ui/*` は foundation の担当ファイル一覧に含まれるため）

```typescript
export interface CandlePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * 依存ライブラリなしの自前SVGローソク足チャート。
 * 25日移動平均線と出来高バーを併せて描画する。
 * @param data 古い→新しい順（open/high/low/close が全て揃っている点のみ描画対象）
 * @param volumes data と同じ長さの出来高配列（任意。無ければ出来高バーを描画しない）
 * @param referenceLines 公開価格・初値のライン（任意。色分けして水平線を描く）
 * @param width SVG幅（既定 335 = max-w-lg内の実効幅目安）
 * @param height SVG高さ（既定 220。出来高バー込みなら +60）
 */
export function Candlestick({
  data,
  volumes,
  referenceLines,
  width = 335,
  height = 220,
}: {
  data: CandlePoint[];
  volumes?: (number | null)[];
  referenceLines?: { label: string; value: number; tone: "accent" | "accent-2" }[];
  width?: number;
  height?: number;
}): React.ReactElement | null;
```

実装方針:
- `data.length < 2` なら `null` を返す（`Sparkline` と同じ規約）
- 25日移動平均は `data` が25件未満の区間は描画しない（`computeMovingAverage(closes: number[], window: number): (number | null)[]` を `src/lib/chart/movingAverage.ts` に純関数として切り出し、foundationが実装。テスト対象）
- 陽線/陰線の色は `--up`/`--down` トークン（既存 `Sparkline`/`PriceChange` と同じ色分けルール: close >= open で up扱い）
- 出来高バーは下部20%の高さに別スケールで描画（価格スケールと混在させない）
- `referenceLines` は水平の破線＋右端にラベル（公開価格ライン＝`accent-2`、初値ライン＝`accent`。トークンは`mobile-design.md`§3準拠）

新規テスト: `src/lib/chart/movingAverage.test.ts`（純関数のみテスト。SVG描画自体はスナップショットテスト等は行わない＝目視確認で足りるとする）。

### 7.3 `PriceCard` への統合（担当: detail。`src/components/detail/PriceCard.tsx` は detail 担当ファイル）

既存の `Sparkline`（小さい折れ線、常時表示）はそのまま残す。新規に折りたたみセクション「6ヶ月チャート」を `PriceCard` 内または `IpoDetailClient` の価格セクション直下に追加し、開いたときに `/api/quote/[code]` を**180日分**取得しなおす（既存は120日固定なので、日数パラメータ化が必要）。

`fetchQuote` のシグネチャ変更: `fetchQuote(code: string, signal?: AbortSignal, days?: number): Promise<QuoteResponse | null>`（`days` 省略時は既存120日のまま後方互換。`route.ts` 側もクエリパラメータ `?days=180` を受け付けるよう拡張。**上限365日でクランプ**し過度な負荷を避ける）。

`<details><summary>6ヶ月チャート（タップで表示）</summary>` の中で `Candlestick` を呼ぶ。開いたときだけ180日分fetchする遅延ロード（初期表示のパフォーマンスを保つため）。`referenceLines` には公開価格（`offeringPrice`）と初値（`initialPrice`）を渡す。

### 7.4 受け入れ基準
- 依存追加なし（package.jsonにチャート系ライブラリが増えていないこと）
- 375px幅でローソク足が横はみ出しなく表示される（`Candlestick` の `width` はコンテナのclientWidthに追従させず固定335pxとし、親要素に `overflow-x-auto` は不要な設計にする＝ max-w-lgのコンテンツ幅に収まる固定値でよい。より厳密にやりたい場合はResizeObserverで可変にしてもよいが**MVPでは固定幅で可**）
- `computeMovingAverage` のテストが境界値（window未満のデータ数、ちょうどwindow件、window超過）をカバー

---

## 8. ホーム画面への反映（担当: home）

Phase2の新要素のうち、ホーム画面のセクション順（既存: サマリー→今後14日の予定→スコア上位ピックアップ→需給ハイライト）は**変更しない**（`mobile-design.md`確定済みの情報設計を壊さないため）。「今後14日の予定」セクションの中身（`upcomingEvents`）に新イベント種別が混ざる形で自然に反映される（§5）。ホーム画面への新規セクション追加は行わない（MVPスコープ外）。

---

## 9. スクリーナーへの反映（担当: screener）

新規条件の追加は必須ではないが、§3のBB参加スコア再校正に伴い、スクリーナーのプリセット「BB参加候補」の説明文に実証結果を反映してよい（任意）。`src/lib/screener/index.ts` の `criteria` 構造・関数シグネチャは変更しない（Phase2スコープ外）。

---

## 10. 設定画面への反映（担当: settings）

§6.7（プッシュ通知UI）に加え、§3で重みプリセットのラベルが変わった場合はプリセット選択UIの表示文言をそのまま反映する（コード変更は不要、`WEIGHT_PRESET_LABELS` を参照しているだけなので自動的に反映される）。

---

## 11. 型定義変更まとめ（integration 担当。既存 `src/types/*` は共有・読み取り専用だが、Phase2ではここに列挙する変更のみ integration タスクが行ってよい）

| ファイル | 変更内容 |
|---|---|
| `src/types/enriched.ts`（新規） | §1.1 `IpoEnriched` 等 |
| `src/types/push.ts`（新規） | §6.3 |
| `src/lib/merge.ts` | `mergeIpos` に `enriched` 引数追加（§1.3）。**呼び出し元全て**（`repository.ts`、テストファイル）を追随修正 |
| `src/lib/repository.ts` | `loadIpoData` に enriched 読み込み追加、`getEnrichedByCode` 新設（§1.4） |
| `src/app/api/quote/[code]/route.ts` | open/high/low 追加、daysクエリパラメータ対応（§7.1） |
| `src/lib/quote.ts` | `QuotePoint` に open/high/low 追加、`fetchQuote` に days引数追加（§7.1） |
| `cloudflare-env.d.ts` | `PUSH_SUBSCRIPTIONS: KVNamespace` 追加（`npm run cf-typegen` 再実行で自動生成されるため手動編集は最小限） |
| `wrangler.jsonc` | `main`変更、`kv_namespaces`追加、`triggers.crons`追加、`vars`追加（§6.6） |
| `package.json` | 依存追加: `@pushforge/builder`。scripts追加: `fetch:enriched` |

**既存の `Ipo` 型（`src/types/ipo.ts`）は変更しない**（enriched由来の追加情報はIpo型に混ぜ込まず、詳細ページで`enriched`を別propsとして扱う設計にしたため。§1.3参照）。

---

## 12. ファイル一覧（新規／変更、タスク別）

### foundation（追加分のみ。既存 `mobile-design.md`§7 の担当範囲に以下を追加）
- 新規: `src/components/ui/Candlestick.tsx`
- 新規: `src/lib/chart/movingAverage.ts` + `.test.ts`
- 追記: `public/sw.js`（push/notificationclickイベント追加。§6.4の注記通りpushタスクの後work）

### data
- 新規: `scripts/fetch_enriched.py`（または `scripts/updater/enriched.ts`）
- 新規: `public/data/ipos.enriched.json`（初回実行で生成）
- 変更: `src/lib/quote.ts`（§7.1、integrationと調整）

### detail
- 新規: `src/components/detail/SimilarStats.tsx`（§2.2）
- 変更: `src/components/detail/Timeline.tsx`（§5.2、1.5倍条項判定表示）
- 変更: `src/components/detail/PriceCard.tsx`（§7.3、6ヶ月チャート折りたたみ）
- 変更: `src/components/detail/ScoreGauges.tsx`（§3.3、BB参加スコア表示調整。任意）

### home
- 変更: `src/lib/home/index.ts` または新規 `src/lib/home/events.ts`（§5.1、新イベント種別）
- 変更: `src/components/home/EventTimeline.tsx`（新種別のアイコン・文言対応）

### screener
- 変更なし（§9、任意対応のみ）

### bb（新規ディレクトリ `src/lib/bb/` は bb タスクが新設）
- 新規: `src/lib/bb/priority.ts` + `.test.ts`（§4.1）
- 新規: `src/lib/bb/lockCalendar.ts` + `.test.ts`（§4.2）
- 新規: `src/components/bb/LockCalendar.tsx`（§4.3）
- 変更: `src/components/bb/BbIpoCard.tsx`（証券会社の並び順をpriority順に、理由表示追加）
- 変更: `src/components/BbManagerClient.tsx`（LockCalendar組み込み）

### settings
- 新規: `src/lib/pwa/environment.ts`（`isInstalledPwa`。§6.7）
- 新規: `src/components/settings/PushNotificationSettings.tsx`
- 変更: `src/components/SettingsClient.tsx`（新セクション組み込み）

### stats（新規タスク）
- 新規: `src/lib/stats/index.ts` + `.test.ts`（§2.1）

### push（新規タスク）
- 新規: `src/types/push.ts`
- 新規: `src/lib/push/subscription.ts` + `.test.ts`
- 新規: `src/lib/push/notify.ts` + `.test.ts`
- 新規: `src/app/api/push/subscribe/route.ts`
- 新規: `src/app/api/push/unsubscribe/route.ts`
- 新規: `worker/push-scheduled.ts`
- 新規: `worker/run-push-notifications.ts`
- 追記: `public/sw.js`（foundationの後）

### integration（単一タスク。§11の型定義変更＋以下の配線）
- 変更: `src/lib/merge.ts`, `src/lib/merge.enriched.test.ts`（新規）
- 変更: `src/lib/repository.ts`
- 変更: `src/app/ipo/[code]/page.tsx`（enriched受け渡し、todayIso受け渡し）
- 変更: `src/components/IpoDetailClient.tsx`（enriched props追加、SimilarStats/Timeline用todayIso中継、BB参加スコア表示調整の最終結線）
- 変更: `src/app/api/quote/[code]/route.ts`
- 変更: `src/lib/scoring/weights.ts`（§3、重みプリセット数値。バックテスト結果次第）
- 変更: `wrangler.jsonc`, `open-next.config.ts`（変更不要なら据え置き）, `cloudflare-env.d.ts`, `package.json`
- 新規: `worker/`ディレクトリの配線確認（pushタスクの成果物を`main`から参照できるようにする最終確認）
- 新規: `scratch/backtest/report-phase2-weights.md`（§3のバックテスト結果）

---

## 13. UI文言・空表示まとめ（禁止語 grep 対象。全タスク共通）

| 状況 | 文言 |
|---|---|
| enriched未取得・base未取得の項目 | 「未取得」（既存踏襲） |
| 類似条件の実績分布・母数不足（3件未満） | 「類似条件の実績データが不足しています」 |
| 資金拘束の重複なし | セクション非表示（文言なし） |
| 資金拘束の重複あり | 「資金拘束が重なっています」 |
| BB参加スコアラベル | 「BB参加スコア（需給重視）」または既存「需給」ラベル+注記「＝BB参加スコア」 |
| プッシュ通知 iOS未インストール | 「iOSでは、まずホーム画面に追加してください（共有→ホーム画面に追加）」 |
| プッシュ通知 未対応ブラウザ | 「このブラウザは通知に対応していません」 |
| 1.5倍条項 成立 | 「解除条件 成立（現在値は参考値）」 |
| 1.5倍条項 未成立 | 「解除条件 未成立」 |
| 6ヶ月チャート折りたたみ見出し | 「6ヶ月チャート（タップで表示）」 |

全て「条件一致」「スコア上位」「機械的集計」「参考情報」「実績分布」の統一表現の範囲内。禁止語（本文書冒頭§0・context.md記載の10語）は src 配下のUI文言に一切使わない。

---

## 14. 実装タスク分割（並列実装の境界）

**原則**: 各タスクは自分の列に無いファイルを一切編集しない。共有ファイル（型・merge・repository・quote route・wrangler.jsonc・IpoDetailClient・page.tsx等）は **integration** タスクのみが触る。既存 `mobile-design.md`§7 の担当表と合わせて運用する（foundation/data/home/ipos/detail/screener/bb/settings は既存タスクの延長）。

| タスク | 担当ファイル（触ってよい範囲） | 他タスクへ公開するインターフェース | 依存順 |
|---|---|---|---|
| **foundation-p2**（既存foundation担当の延長） | `src/components/ui/Candlestick.tsx`, `src/lib/chart/movingAverage.ts`(+test), `public/sw.js`（push追記部分を除く基本部分は先行、pushの追記は後述の通りpush待ち） | `Candlestick` コンポーネント（props: §7.2）, `computeMovingAverage(closes, window)` | 依存なし（最初に着手可） |
| **data-p2**（既存data担当の延長） | `scripts/fetch_enriched.py`（または`.ts`）, `public/data/ipos.enriched.json`, `src/lib/quote.ts`（open/high/low追加はintegrationと調整。単独で進める場合はこのタスクが先に変更しintegrationが合流） | `IpoEnriched[]` を書き出す `ipos.enriched.json` のファイル形式（§1.1のスキーマ厳守）, `QuotePoint`拡張後の型 | 依存なし（型定義§1.1は本設計書で確定済みのため着手可） |
| **stats**（新規） | `src/lib/stats/index.ts`(+test) | `computeReturnDistribution`, `similarConditionDistribution`, `underwriterBreakEvenStats` 等（§2.1のシグネチャ） | 依存なし（`Ipo`型のみ使用、既存で確定済み） |
| **bb-strategy**（新規） | `src/lib/bb/priority.ts`(+test), `src/lib/bb/lockCalendar.ts`(+test) | `rankBrokersForIpo`, `extractLockPeriods`, `findLockOverlaps`（§4.1-4.2のシグネチャ） | 依存なし |
| **push**（新規） | `src/types/push.ts`, `src/lib/push/*`(+test), `src/app/api/push/*/route.ts`, `worker/push-scheduled.ts`, `worker/run-push-notifications.ts`, `public/sw.js`のpush関連追記のみ | `PushSubscriptionJson`, `PushSubscriberRecord`型, `/api/push/subscribe`・`/api/push/unsubscribe`のAPI契約（§6.3-6.5） | **foundation-p2 の `public/sw.js` 基本部分完了後**（同一ファイルの追記のため）。それ以外は依存なし |
| **home-p2**（既存home担当の延長） | `src/lib/home/index.ts`または`src/lib/home/events.ts`(+test), `src/components/home/EventTimeline.tsx` | 新イベント種別を含む`upcomingEvents`の戻り値（§5.1） | 依存なし（既存Ipoフィールドのみ使用） |
| **detail-p2**（既存detail担当の延長） | `src/components/detail/SimilarStats.tsx`, `src/components/detail/Timeline.tsx`, `src/components/detail/PriceCard.tsx`, `src/components/detail/ScoreGauges.tsx` | なし（末端UI） | **stats タスク**（SimilarStats用）, **foundation-p2**（Candlestick用）, **data-p2**（quote route拡張用、間接的にintegration経由） の完了後 |
| **bb-p2**（既存bb担当の延長） | `src/components/bb/LockCalendar.tsx`, `src/components/bb/BbIpoCard.tsx`, `src/components/BbManagerClient.tsx` | なし（末端UI） | **bb-strategy タスク**の完了後 |
| **settings-p2**（既存settings担当の延長） | `src/lib/pwa/environment.ts`, `src/components/settings/PushNotificationSettings.tsx`, `src/components/SettingsClient.tsx` | なし（末端UI） | **push タスク**（API契約）の完了後 |
| **integration**（単一タスク。既存integrationの延長） | §11・§12「integration」列の全ファイル | 最終的な結線（`mergeIpos`新シグネチャ、`Ipo`型は不変のまま enriched は別props） | **data-p2**（IpoEnriched型・enriched.json形式）, **push**（worker配線）, **bb-strategy**（重み変更の根拠となるバックテストはintegration自身が実施） の完了後に着手。**最後に実行し、全タスクの成果物を配線する** |

### 依存順の要約（レーン図）

```
着手可能（依存なし）:
  foundation-p2, data-p2, stats, bb-strategy, home-p2

foundation-p2 完了後:
  push（sw.js追記部分）, detail-p2（Candlestick利用部分）

data-p2 完了後（IpoEnriched.jsonの形が確定した時点で並行着手可）:
  integration（merge.ts拡張）

stats 完了後:
  detail-p2（SimilarStats）

bb-strategy 完了後:
  bb-p2

push 完了後:
  settings-p2

全タスク完了後、最後:
  integration（型配線・重みバックテスト・最終ビルド確認）
```

**重要**: `integration` は他の全タスクの成果物（新規ファイル・新規関数のシグネチャ）を「呼ぶだけ」で済むように、この設計書で全インターフェースを事前確定してある。他タスクは integration の完了を待たずに自分のファイル内で完結する実装・単体テストまで進められる設計にしてある（`IpoDetailClient.tsx` 等の共有ファイルへの差し込みだけが integration 待ちになる）。

---

## 15. テスト観点まとめ（全体）

- `src/lib/merge.enriched.test.ts`: 3層マージの優先順位（base>enriched>auto）、既定値判定の境界
- `src/lib/stats/index.test.ts`: 分布統計の母数0・中央値の偶数/奇数件数・帯の境界値
- `src/lib/bb/priority.test.ts`: 優先度スコアの根拠別加点
- `src/lib/bb/lockCalendar.test.ts`: 期間重複判定の境界（同日）
- `src/lib/home/events.test.ts`（または`index.test.ts`追加分）: 新イベント種別の抽出・境界
- `src/lib/chart/movingAverage.test.ts`: window未満/ちょうど/超過
- `src/lib/push/notify.test.ts`: 対象日抽出ロジック
- `src/lib/push/subscription.test.ts`: モックKVでの読み書き
- 既存テスト（154件）が全て通ること（`mergeIpos`シグネチャ変更に伴う既存呼び出し元の追随修正を含む）

## 16. 受け入れ基準（納品ゲート。`mobile-design.md`§8 に準拠、Phase2固有分を追加）

- `npx tsc --noEmit` エラー0 / `npm run lint` エラー0 / `npm test` 全通過 / `npm run build` 成功
- custom worker構成（`main`変更後）でも `npm run build`（`opennextjs-cloudflare build`）が成功する
- 375px・1280pxで全ルート（新規: `/ipo/<コード>` の6ヶ月チャート展開状態、`/bb` の資金拘束カレンダー表示状態を含む）の横はみ出し0
- 禁止語grep（§13の文言含め）が src配下でゼロ
- `public/data/ipos.enriched.json` が生成され、`IpoEnriched`スキーマに準拠（`npx tsc --noEmit`で型検証されるが、JSON自体の簡易バリデーションスクリプトがあれば尚良い。必須ではない）
- 重みプリセット変更を行った場合、`scratch/backtest/report-phase2-weights.md` が存在し検証結果を記録
- 新規localStorageキーを追加した場合（本設計では追加なし想定。push購読状態はKV管理でlocalStorageを使わない設計のため）、`ipo-analyzer:<name>:v1`形式であること

---

## 設計メモ（将来案。8〜10。実装しない。各1段落）

**8. クラウド同期D1**: 現状 localStorage 完結のBB申込・メモ・ウォッチリストを、Cloudflare D1（SQLite互換）でユーザーアカウント単位に同期する案。認証（メール+マジックリンク等）の追加が必要で、Cloudflareの無料枠内でD1自体は使えるが認証基盤の実装コストが大きい。Phase3以降、複数デバイスでの利用が本人の実運用で必要になった時点で着手判断。

**9. ネイティブ化**: `capacitor.config.ts` は整備済み（`mobile-design.md`§4）。`npx cap add ios/android` はXcode/Android Studioのローカル環境が必要で今回は未実行。ネイティブプッシュ通知（APNs経由）はWeb Pushと別実装が必要になるため、Web Push運用が安定してから本人判断で着手。

**10. M1夜間ジョブ**: `scripts/updater/main.ts`（JPX+Yahoo Finance+EDINET）と本設計の `fetch_enriched`（96ut）を、M1予備機のcronで定期実行し結果をGit経由でデプロイに反映する運用案。現状は手動実行（`npm run update:data`）。夜間の自動実行はM1のジョブ管理（`~/.claude/rules/m1-server.md`）の枠組みで別途設定する。
