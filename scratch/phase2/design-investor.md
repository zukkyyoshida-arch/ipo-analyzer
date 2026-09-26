# Apollo IPO Phase 2 設計書（投資家の意思決定フロー優先 / 2026-09-25）

実装エージェントはこの文書だけを読んで実装できることを目標にする。判断に迷ったら
「BBに参加するか→どの口座から→当選後に初値で売るか持つか→上場後いつ何を見るか」という
投資家の行動順で、各画面に何が要るかを逆算する。実証データ（`scratch/backtest/report.md`）
で効くと分かった要因（吸収金額・オファリングレシオ・主幹事別公募割れ率・仮条件上限決定・
ロックアップ・地合い）を各画面の最前面に出す。データが無い項目は正直に「未取得」。

本文書は `scratch/phase2/context.md`（現状・データソース・本人裁定）と
`scratch/mobile-design.md`（§3 デザイントークン・§6 禁止語・§7 ファイル分担・§8 納品ゲート）
を前提とする。矛盾があれば本文書（Phase 2 固有の指示）を優先する。

---

## 0. 全体方針・スコープ

Phase 2 は次の7項目を実装する（context.md 末尾のスコープ1〜7に対応）。

1. §1 データ拡充: `IpoEnriched` レイヤー（96ut.com 取得）
2. §2 統計: 類似IPOの初値実績・吸収金額帯/主幹事別/OR帯別の分布
3. §3 スコア再校正: BB参加スコアの新設・重み初期値の実証見直し
4. §4 BB戦略ボード: 申込優先順位・資金拘束カレンダー
5. §5 イベントカレンダー: ロックアップ解除・1.5倍条項・決算・大量保有
6. §6 プッシュ通知: Web Push（VAPID）+ Workers Cron + KV
7. §7 セカンダリー深化: 自前SVGローソク＋25日MA＋出来高

各節は「投資家の行動順」に沿って画面へどう反映するかを併記する。8〜10（クラウド同期D1・
ネイティブ化・M1夜間ジョブ）は §14 設計メモに将来案として1段落ずつ書くのみで実装しない。

### レンズ: 投資家の意思決定フロー

```
① BBに参加するか？        → スコア（需給・ファンダ）＋ 新設「BB参加スコア」＋ 実績分布
② どの口座から申し込むか？  → 主幹事/幹事団の配分・抽選方式・前受金有無・当選確率の目安
③ 当選後、初値で売るか持つか？→ 初値予想の代わりに「類似条件の実績分布」（中央値・勝率）
④ 上場後いつ何を見るか？    → イベントカレンダー（決算・ロック解除・1.5倍ライン）＋ 通知
```

この順序をホーム画面のセクション順・詳細ページのセクション順の設計原則にする（§8, §9）。

### 制約（必ず遵守）

- 禁止語（src 配下ゼロ）: 買い／買う／売り推奨／推奨／おすすめ／お宝／必勝／爆益／
  テンバガー／勝てる／儲か。統一表現: 「条件一致」「スコア上位」「機械的集計」「参考情報」
  「実績分布」。他サイトの「初値予想」「BB参加姿勢」等の主観評価は取り込まない
- 既存ファイル削除なし。localStorage キー変更なし（新キーは `ipo-analyzer:<name>:v1`）
- 依存追加は最小限。チャートライブラリは入れない（自前SVG）。Web Push は Workers 互換のみ
- Cloudflare 有料機能は使わない（Workers KV は無料枠内で使用可。Cron Triggers も無料枠内）
- 新ルール・重みは実装前に `scratch/backtest/` で実証済みのもののみ採用（§3 に根拠を明記）
- 「今日」はサーバー側で計算し props で渡す。クライアントで `Date.now()` を使わない
- ページは Server Component でデータ取得し Client へ props。`"use client"` は必要な箇所のみ
- 秘密情報は `.env` のみ

### 追記反映（2026-09-25 17:28 実測分）

- 96ut のサイトマップ（`post-sitemap.xml`〜`post-sitemap6.xml`）から 2024〜2026 年の全記事URL（約190件）を発見できる。**上場予定銘柄だけでなく base の CSV 由来157件も対象に含めて取得する**（BB期間・仮条件・株数・OR・幹事団・ロックアップ・業績を補完でき、§2 統計の母数が増える）
- 1 req/秒で全件取得しても3〜4分。§1 のバッチ取得はこの全件を対象にする

---

## §1. データ拡充レイヤー（96ut.com → `IpoEnriched`）

### 目的（投資家フローとの対応）

①「BBに参加するか」の判断材料（仮条件・吸収金額・OR・主幹事・VC・ロックアップ・業績）を
JPX発見銘柄（40件、ほぼ全項目未取得）と base の157件（BB日程・株数内訳・幹事団が欠落）
の両方で埋める。埋まるほど §2 の統計母数・§3 のBB参加スコアの精度が上がる。

### 新規ファイル

| パス | 役割 |
|---|---|
| `scripts/enrich/config.ts` | 96ut の定数（BASE_URL, USER_AGENT, HTTP_TIMEOUT_MS=20000, REQUEST_INTERVAL_MS=1000, FILES.enriched） |
| `scripts/enrich/sitemap.ts` | サイトマップから記事URL一覧を収集する純関数＋fetchラッパ |
| `scripts/enrich/parse96ut.ts` | 96utの記事HTML1件をパースして `Enriched96ut` を返す純関数（テスト対象） |
| `scripts/enrich/main.ts` | エントリポイント。`npm run enrich:data` で実行 |
| `src/types/enriched.ts` | `IpoEnriched` 型定義 |
| `public/data/ipos.enriched.json` | 96ut由来の拡充データ（code をキーにした配列） |
| `scripts/enrich/parse96ut.test.ts` | パーサのテスト（サンプルHTML断片を使う） |

`scripts/enrich/*` は既存 `scripts/updater/*` と対等な独立パイプライン（読み取り専用で
`scripts/updater/*` を参照してよいが変更しない）。

### 型定義: `src/types/enriched.ts`

```typescript
// 96ut.com から取得した拡充データ。JPX発見銘柄・base双方の欠落項目を補う「第2データソース」層。
// merge 優先順は base（手動）＞ enriched（本レイヤー）＞ auto（価格等）。
// 出典・鮮度を必ず保持し、UIでは使わないが更新運用・検証のログとして残す。

export interface EnrichedProvenance {
  /** 取得元URL（例: https://kabu.96ut.com/article/ipo/2026035/） */
  sourceUrl: string;
  /** 取得日時（ISO） */
  fetchedAt: string;
}

/** 96utの幹事団1社分の割当情報。 */
export interface UnderwriterAllocation {
  name: string;
  /** 割当株数。取得不能なら null */
  shares: number | null;
  /** 割当比率（%）。取得不能なら null */
  ratioPercent: number | null;
}

/** 96utの大株主1件分（ロックアップ確認用）。 */
export interface MajorShareholder {
  name: string;
  shares: number;
  ratioPercent: number;
  /** ロックアップ日数。取得不能・記載なしは null */
  lockupDays: number | null;
}

/**
 * 96ut 由来の1銘柄分。すべて「取得できたものだけ」入る任意フィールド
 * （code とメタ情報のみ必須）。undefined はマージで無視する。
 */
export interface IpoEnriched {
  code: string;
  provenance: EnrichedProvenance;

  bbPeriod?: { start: string; end: string };
  /** 公開価格決定日（=抽選日相当）。YYYY-MM-DD */
  allotmentDate?: string;
  purchasePeriod?: { start: string; end: string };
  listingDate?: string;

  publicShares?: number;
  saleShares?: number;
  overAllotment?: number;
  /** 総株式数（公募+売出+OA）。offeringRatio 再計算の分母確認用 */
  totalOfferedShares?: number;
  offeringRatio?: number;

  assumedPrice?: number;
  /** 仮条件。未発表なら省略（null は入れない＝undefinedのままマージ側で既存値を維持） */
  priceRange?: { low: number; high: number };
  offeringPrice?: number | null;

  /** 吸収金額（億円）。想定/公開/初値の3値のうち、公開ベースを absorptionAmount として採用 */
  absorptionAmount?: number;
  marketCap?: number;

  leadUnderwriter?: string;
  underwriters?: string[];
  /** 幹事団の割当内訳（BB戦略ボード §4 の配分表示に使う） */
  underwriterAllocations?: UnderwriterAllocation[];

  financials?: {
    revenue: number;
    revenueGrowth: number;
    operatingProfit: number;
    isProfitable: boolean;
  };

  vcRatio?: number;
  lockup?: { days: number; hasPriceRelease: boolean; coverage: number };
  majorShareholders?: MajorShareholder[];
}
```

### `scripts/enrich/parse96ut.ts` の純関数シグネチャ

```typescript
export interface Enriched96utRaw {
  code: string;
  name: string;
  fields: Record<string, string>; // th見出し(正規化済み) -> td生テキスト
}

/** 記事タイトル「<社名>(<コード>)のIPO新規上場情報」からコードを抽出。取れなければ null。 */
export function extractCodeFromTitle(title: string): string | null;

/** 記事HTMLからテーブル行(th/td)を素朴に抽出する（cheerio使用）。 */
export function extractRawFields(html: string): Record<string, string>;

/** "1,200円～1,400円" 等のレンジ文字列をパース。"未発表"/"-" は null。 */
export function parsePriceRangeText(text: string): { low: number; high: number } | null;

/** "2026/09/29 (火) ～ 終了: 2026/10/02 (金)" 形式からBB期間を抽出。 */
export function parseBbPeriodText(text: string): { start: string; end: string } | null;

/** 幹事団テーブル（証券会社名・割当数・割当%）をパース。 */
export function parseUnderwriterAllocations(html: string): UnderwriterAllocation[];

/** 大株主テーブル（氏名・株数・割合・ロックアップ日数）をパース。 */
export function parseMajorShareholders(html: string): MajorShareholder[];

/**
 * 記事HTML1件を IpoEnriched へ変換する。パースは寛容（items単位でtry/catch、
 * 失敗したフィールドはundefinedのまま次へ進む）。code を抽出できなければ null を返す
 * （呼び出し側でスキップしてログに残す）。
 */
export function parse96utArticle(
  html: string,
  sourceUrl: string,
  fetchedAtIso: string,
): IpoEnriched | null;
```

### `scripts/enrich/sitemap.ts`

```typescript
/** サイトマップインデックス(sitemap.xml)から post-sitemap*.xml のURL一覧を取得。 */
export async function fetchSitemapIndex(): Promise<string[]>;

/** 1つの post-sitemap*.xml から /article/ipo/<code>/ 形式のURLだけを抽出。 */
export function extractIpoArticleUrls(sitemapXml: string): string[];

/** 全 post-sitemap*.xml を辿って IPO記事URLの重複排除済み一覧を返す。 */
export async function collectAllIpoArticleUrls(): Promise<string[]>;
```

### `scripts/enrich/main.ts` の処理フロー

1. `collectAllIpoArticleUrls()` でURL一覧取得（約190件）
2. 1件ずつ `1000ms` 間隔で fetch（UA明示・タイムアウト20秒・失敗はwarn+スキップして続行、
   robots.txt の `/wp-admin/` Disallow のみなので記事パスは許可対象）
3. `parse96utArticle()` でパース。null（code抽出失敗）はスキップしてログ出力
4. 結果配列を `public/data/ipos.enriched.json` へ書き込み（`writeJsonIfChanged` 相当を
   `scripts/updater/io.ts` から import して再利用可。読み取り専用で使ってよい）
5. サマリ出力: 対象件数・成功件数・失敗件数・失敗URL一覧

`package.json` の scripts に `"enrich:data": "tsx --env-file-if-exists=.env scripts/enrich/main.ts"`
を追加（foundation タスクが依存追加と合わせて行う。§10 参照）。

### merge の優先順拡張（`src/lib/merge.ts` の変更 — data タスクが担当）

現状 `mergeIpos(base, auto)` を `mergeIpos(base, enriched, auto)` に拡張する。優先順は
**base（手動）＞ enriched（96ut）＞ auto（updater価格等）**。

```typescript
// 既存 mergeOne(base, auto) の前に、base に enriched を重ねる中間関数を追加する。
// enriched は「base が既定値（未取得）のフィールドのみ」埋める。base に手動で
// 入力済みの値は enriched で上書きしない（本人が既に確認済みの情報を優先）。

/** base の該当フィールドが「未取得の既定値」かどうかを判定するヘルパ群。 */
function isDefaultBbPeriod(v: { start: string; end: string }): boolean;
function isDefaultDateRange(v: { start: string; end: string }): boolean; // purchasePeriod用（同実装を共有可）
function isDefaultPriceRange(v: { low: number; high: number }): boolean; // {0,0} または offeringPriceと同値

/**
 * base に enriched を重ねる。base の値が既定値（未取得）のときだけ enriched の値で埋める。
 * 新規発見銘柄（skeletonFromAuto 相当）にも同じ規則で適用できるよう、
 * IpoBase | Ipo のどちらでも受けられる型にする。
 */
export function applyEnriched(base: Ipo, enriched: IpoEnriched | undefined): Ipo;

/** base配列にenriched配列を重ねた中間結果を返す（auto適用前）。 */
export function applyEnrichedAll(base: IpoBase[], enriched: IpoEnriched[]): Ipo[];

// mergeIpos の新シグネチャ:
export function mergeIpos(base: IpoBase[], enriched: IpoEnriched[], auto: IpoAuto[]): Ipo[];
```

具体的な埋め規則（`applyEnriched` 内、フィールドごと）:

| base側フィールド | 「未取得」判定 | enriched埋め値 |
|---|---|---|
| `bbPeriod` | `start==="" && end===""` | `enriched.bbPeriod` |
| `allotmentDate` | `===""` | `enriched.allotmentDate` |
| `purchasePeriod` | `start==="" && end===""` | `enriched.purchasePeriod` |
| `publicShares`/`saleShares`/`overAllotment` | `===0` | 個別に埋める |
| `offeringRatio` | `===0` | `enriched.offeringRatio`（無ければ `publicShares+saleShares` から再計算） |
| `priceRange` | `low===0 && high===0` | `enriched.priceRange` |
| `offeringPrice` | `===null` | `enriched.offeringPrice ?? null`（ただし enriched 側が `null` なら上書きしない＝undefinedと同義に扱う） |
| `absorptionAmount` | `===0` | `enriched.absorptionAmount` |
| `marketCap` | `===0` | `enriched.marketCap` |
| `underwriters` | `length<=1`（主幹事のみ） | `enriched.underwriters`（主幹事を含めて統合・重複排除） |
| `financials.*` | `revenueGrowth===0` を代表指標に全体を埋める | `enriched.financials` |
| `vcRatio` | `===0` | `enriched.vcRatio` |
| `lockup` | `days===0` | `enriched.lockup` |

`underwriterAllocations` と `majorShareholders` は `Ipo` 型に無いため、`repository.ts` 側で
別途 `code -> IpoEnriched` の Map を保持し、BB戦略ボード（§4）・イベントカレンダー（§5）が
直接 `ipos.enriched.json` を参照する（`Ipo` 型は変更しないので既存コードへの影響がない）。

### `src/lib/repository.ts` の変更（data タスク）

```typescript
// 追加
import bundledEnriched from "../../public/data/ipos.enriched.json";
const FALLBACK_ENRICHED = bundledEnriched as IpoEnriched[];

export interface IpoDataSet {
  ipos: Ipo[];
  market: MarketData;
  enriched: IpoEnriched[]; // 追加。BB戦略ボード・イベントカレンダーが幹事配分/大株主を参照する
}

// loadIpoData 内: enriched も base/auto と同様にリモート取得→フォールバックし、
// mergeIpos(base, enriched, auto) を呼ぶ。

export async function getEnrichedByCode(code: string): Promise<IpoEnriched | undefined>;
export function findEnriched(all: IpoEnriched[], code: string): IpoEnriched | undefined;
```

### テスト観点

- `parsePriceRangeText`: "1,200円～1,400円" / "未発表" / "-" / 全角チルダ
- `parseBbPeriodText`: 開始・終了が同一行 / 曜日カッコ書き / 年またぎなし
- `extractCodeFromTitle`: 通常形式 / コード4桁数字 / コード3桁+英字1桁
- `applyEnriched`: base既定値→enrichedで埋まる／base手動値→enrichedで上書きされない／
  enriched未取得(undefined)→base既定値のまま
- `extractIpoArticleUrls`: 正しいURLのみ抽出・重複排除
- 実データ1件（ルクレ 648A 相当のHTML断片をfixtureとして保存）でのゴールデンテスト

### 受け入れ基準

- `npm run enrich:data` が実行でき、`public/data/ipos.enriched.json` が生成される
- `mergeIpos` の新シグネチャで既存呼び出し元（`repository.ts`）がコンパイルエラーなし
- 既存 `merge.test.ts` は `mergeIpos(base, [], auto)` で従来と同じ結果になることを確認する
  テストケースを追加（enriched空配列＝後方互換）
- JPX発見銘柄（insufficient）のうち96utに記事がある銘柄は `partial` 以上に改善する

---

## §2. 類似IPOの初値実績と統計

### 目的（投資家フローとの対応）

③「当選後、初値で売るか持つか」の判断材料。他人の「初値予想」は使わず、**同じ条件の銘柄が
過去どうなったか**という実績分布だけを見せる。分布は中央値・勝率（公募超え率）・件数（母数）
を必ずセットで出し、母数が少なければ「参考情報（母数n件）」と明記する。

### 新規ファイル

| パス | 役割 |
|---|---|
| `src/lib/stats/index.ts` | 統計の純関数群（帯分け・分布集計） |
| `src/lib/stats/stats.test.ts` | テスト |
| `src/components/detail/OutcomeDistribution.tsx` | 詳細ページ用の実績分布カード（detail タスク） |

`src/lib/stats/*` は共有ファイル扱い（新規追加なので既存分担表にないが、`src/lib/screener/*`
と同格の「純関数ライブラリ」。**stats タスク**が単独で担当し、他タスクは読み取り専用で使う。
§10 のタスク分割表に記載）。

### 型定義・純関数シグネチャ（`src/lib/stats/index.ts`）

```typescript
import type { Ipo, Market } from "@/types/ipo";

/** 吸収金額帯（億円）。実証データの区切り（report.md: 1-5億/100億超で成績が大きく違う）に合わせる。 */
export type AbsorptionBand = "under10" | "10to30" | "30to100" | "over100";

export function classifyAbsorptionBand(absorptionAmount: number): AbsorptionBand;

/** オファリングレシオ帯（%）。report.md: 10%未満+53.1% / 50%超-2.9%。 */
export type OfferingRatioBand = "under10" | "10to30" | "30to50" | "over50";

export function classifyOfferingRatioBand(offeringRatio: number): OfferingRatioBand;

export interface OutcomeSample {
  code: string;
  name: string;
  /** 初値騰落率（%）。initialReturnRate(ipo) の値。 */
  returnRate: number;
}

export interface OutcomeDistributionResult {
  /** 対象件数（母数）。 */
  sampleCount: number;
  /** 初値が公開価格を上回った件数の割合（%）。母数0なら null。 */
  winRate: number | null;
  /** 初値騰落率の中央値（%）。母数0なら null。 */
  medianReturnRate: number | null;
  /** 初値騰落率の平均（%）。母数0なら null。 */
  meanReturnRate: number | null;
  /** 参考として返す個別サンプル（新しい順、最大10件）。 */
  samples: OutcomeSample[];
}

const EMPTY_DISTRIBUTION: OutcomeDistributionResult = {
  sampleCount: 0, winRate: null, medianReturnRate: null, meanReturnRate: null, samples: [],
};

/**
 * 「吸収金額帯×市場×地合い」が一致する上場済み銘柄の初値実績分布を返す。
 * 地合いは対象銘柄の上場日時点のものを厳密に復元できないため、
 * 「現在の設定地合い」を条件から除外し、まずは「吸収金額帯×市場」のみで絞り込む
 * （地合いはフィルタではなく将来の拡張余地として型に残す。v1は market + band のみ使用）。
 * targetIpo自身は対象から除外する。
 */
export function outcomeDistributionByAbsorptionBand(
  allIpos: Ipo[],
  targetIpo: Ipo,
): OutcomeDistributionResult;

/** 主幹事別の公募割れ率（初値<公開価格の割合）。上場済み・公開価格/初値あり銘柄のみ対象。 */
export interface UnderwriterBreakEvenStat {
  underwriter: string;
  sampleCount: number;
  breakEvenRate: number; // %
}
export function underwriterBreakEvenStats(allIpos: Ipo[]): UnderwriterBreakEvenStat[];

/** 特定の主幹事1社分の統計を1件返す（詳細ページで自社の主幹事だけ表示する用）。母数0ならnull。 */
export function underwriterBreakEvenStat(
  allIpos: Ipo[],
  underwriter: string,
): UnderwriterBreakEvenStat | null;

/** OR帯別の初値騰落率分布（スクリーナー・BB戦略ボードの参考表で使う）。 */
export interface OfferingRatioBandStat {
  band: OfferingRatioBand;
  sampleCount: number;
  medianReturnRate: number | null;
  winRate: number | null;
}
export function offeringRatioBandStats(allIpos: Ipo[]): OfferingRatioBandStat[];

export const ABSORPTION_BAND_LABELS: Record<AbsorptionBand, string>;
export const OFFERING_RATIO_BAND_LABELS: Record<OfferingRatioBand, string>;
```

中央値計算は配列を複製してソートし、偶数件は中央2件の平均。`initialReturnRate` は既存
`src/lib/format.ts` の関数を再利用する（新規実装しない）。

### UI: `OutcomeDistribution.tsx`（詳細ページ・detail タスク担当）

配置: 詳細ページの「価格」セクション直後、「スコア」セクションより前（③の判断材料を
最初に見せる。§9 で確定）。

表示文言:
- 見出し: 「類似条件の初値実績」
- 条件行: 「吸収金額 {帯ラベル}・{市場} で上場した銘柄」
- サンプル0件: 空状態カード「同条件の実績データがまだありません（参考情報）」
- サンプル1〜4件: 数値は出すが見出し直下に「参考情報（母数{n}件、目安として弱い）」を必ず表示
- サンプル5件以上: 「参考情報（母数{n}件）」
- 本体: KpiTile的な3列（初値超え率 / 騰落率中央値 / 母数）＋ 直近サンプル最大5件を
  `code・name・騰落率%` の ListRow で列挙（IpoCard は使わない軽量表示）
- 数値は必ず「実績」であり「予想」ではない旨を末尾1行で明記:
  「上場済み銘柄の実績を機械的に集計した値です。将来の値動きを示すものではありません。」

### 受け入れ基準

- 母数0件のとき絶対にpassやfailの断定文言を出さない（空状態のみ）
- 195銘柄前後（181+96ut補完後の増分）に対し `outcomeDistributionByAbsorptionBand` が
  1秒未満で完了する（O(n)実装で十分、事前ソート等は不要）
- テスト: 帯の境界値（9.9/10/29.9/30/99.9/100億円）、winRate=0%とnull(母数0)の区別、
  中央値の偶数/奇数件

---
## §3. BB参加スコアの再校正

### 目的（投資家フローとの対応）

①「BBに参加するか」の最終判断材料。既存の需給/ファンダ2軸スコアは「上場後の値動き予測」寄りの
設計（`scoring/items.ts` 11項目）で、実証データ（`report.md`）が勝率7〜8割と示した
「BB当選→初値売り」の勝ち筋に特化していない。**既存スコアは変更せず**、新しい第3軸
「BB参加スコア」を追加する（既存の `IpoScoreResult.supplyDemand` / `.fundamental` は非破壊）。

### 実証根拠（`report.md` から採用する項目のみ）

| 要因 | 実証内容 | 採用可否 |
|---|---|---|
| 吸収金額 | 1〜5億円 平均+221% vs 100億円超 +28.9% | 採用（既存 `scoreAbsorption` のロジックを流用） |
| オファリングレシオ | 10%未満 +53.1% vs 50%超 −2.9% | 採用（新規項目。既存スコアに同名項目はない） |
| 主幹事別公募割れ率 | SMBC日興9% vs 大和30%（実データで差が出る） | 採用（§2 `underwriterBreakEvenStat` を使う。ハードコード係数ではなく実績値） |
| 仮条件上限決定 | 「仮条件が想定より上振れ」が良い兆候（既存checklistの`checkPriceRangeRevision`と同ロジック） | 採用 |
| ロックアップ | VC比率×ロック強度の組合せが出口売り圧力に影響 | 採用（既存 `scoreVcLockup` のロジックを流用） |
| 地合い | 強い地合いほど初値が良い | 採用（既存 `scoreSentiment` を流用） |
| 総合スコアS〜Dランク・RSI逆張り・利確目標絶対水準 | 実証で **逆効果 or 設計バグ** と判定済み | **不採用**（Streamlit版の失敗を踏襲しない） |

既存の `scoreDownside`（複合条件フラグ）・`scoreMarket`・`scoreTheme`・`scoreSchedule` は
「BB参加スコア」には含めない（需給スコアとの役割重複を避け、BBスコアは実証要因のみで構成する）。

### 新規ファイル

| パス | 役割 |
|---|---|
| `src/lib/scoring/bb.ts` | BB参加スコアの項目関数＋合成関数（純関数、テスト対象） |
| `src/lib/scoring/bb.test.ts` | テスト |

`src/lib/scoring/bb.ts` は **scoring タスク**が担当する新規ファイル（既存 `scoring/*` は
共有・読み取り専用のままだが、新規ファイル追加のみ行う。既存ファイルの中身は変更しない）。

### 型定義・シグネチャ（`src/lib/scoring/bb.ts`）

```typescript
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "./types";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";

/** BB参加スコアの項目キー。 */
export type BbScoreItemKey =
  | "absorption"       // 吸収金額（既存 scoreAbsorption と同ロジックを再利用）
  | "offeringRatioBb"  // オファリングレシオ（新規。BB版は10%刻みでより細かい配点）
  | "underwriterTrack" // 主幹事別公募割れ率の実績（新規。実データ由来、ハードコードでない）
  | "priceRangePosition" // 仮条件の位置（既存checklistのロジックをスコア化）
  | "vcLockup"         // VC比率×ロックアップ強度（既存 scoreVcLockup と同ロジックを再利用）
  | "sentiment";        // 地合い（既存 scoreSentiment と同ロジックを再利用）

export const BB_SCORE_KEYS: BbScoreItemKey[];

export const BB_SCORE_ITEM_LABELS: Record<BbScoreItemKey, string>;

/** BB参加スコア専用の重み（0以上の整数）。既存 ScoreWeights とは別枠。 */
export type BbScoreWeights = Record<BbScoreItemKey, number>;

/**
 * 実証根拠に基づく初期重み。数値根拠は上表の実証内容（差の大きさ）に比例させる:
 * オファリングレシオ（53.1pt差）と吸収金額（192pt差）を最重量、主幹事実績と
 * 仮条件位置を中、VCロックアップ・地合いを軽めにする。
 */
export const DEFAULT_BB_WEIGHTS: BbScoreWeights = {
  absorption: 4,
  offeringRatioBb: 4,
  underwriterTrack: 3,
  priceRangePosition: 3,
  vcLockup: 2,
  sentiment: 2,
};

export interface BbScoreItemOutput {
  key: BbScoreItemKey;
  label: string;
  points: number; // -2〜+2
  weight: number;
  contribution: number;
  rawText: string;
  reason: string;
}

export interface BbScoreResult {
  /** 0〜100 に換算したBB参加スコア。 */
  score: number;
  items: BbScoreItemOutput[];
}

/** オファリングレシオ: <10%=+2 / <20%=+1 / <30%=0 / <50%=-1 / それ以上=-2（report.md の帯に対応）。 */
export function scoreOfferingRatioBb(ipo: Ipo): { points: number; rawText: string; reason: string };

/**
 * 主幹事別公募割れ率の実績を使う。stats（underwriterBreakEvenStat）の結果を引数で受け取る
 * （純関数を保つため、ここでは allIpos を直接読まず呼び出し側が事前計算して渡す）。
 * 母数5件未満は unknown 扱いで 0点・reason に「参考データ不足」と明記。
 */
export function scoreUnderwriterTrack(
  stat: UnderwriterBreakEvenStat | null,
): { points: number; rawText: string; reason: string };

/** 仮条件の位置。checklist の checkPriceRangeRevision と同じ判定をスコア化（上振れ+2/レンジ内0/下振れ-2/未確定は0）。 */
export function scorePriceRangePosition(ipo: Ipo): { points: number; rawText: string; reason: string };

/**
 * BB参加スコアを算出する。underwriterStat は呼び出し側が
 * `underwriterBreakEvenStat(allIpos, ipo.leadUnderwriter)` で事前計算して渡す。
 */
export function scoreBbParticipation(
  ipo: Ipo,
  settings: ScoreSettings, // sentiment のみ使用
  underwriterStat: UnderwriterBreakEvenStat | null,
  weights?: BbScoreWeights, // 省略時 DEFAULT_BB_WEIGHTS
): BbScoreResult;
```

`absorption` と `vcLockup` は `scoring/items.ts` の `scoreAbsorption` / `scoreVcLockup` を
そのまま import して再利用する（ロジック重複を避ける。`scoring/items.ts` は変更しない）。

### 需給重視プリセットの更新（`src/lib/scoring/weights.ts` — scoring タスクが変更してよい唯一の既存ファイル）

`SUPPLY_DEMAND_WEIGHTS`（需給重視プリセット）は変更しない（既存の2軸スコアは非破壊の方針）。
代わりに、BB参加スコア側に「バランス」1種類のみのプリセットを持たせる（v1はプリセット切替
機能を作らず `DEFAULT_BB_WEIGHTS` 固定。設定画面のスライダーで個別調整は可能にする＝§9設定）。

### UI表示

- 詳細ページ: 既存の3ゲージ（需給・ファンダ・総合）の横に4つ目のゲージ「BB参加」を追加
  （`ScoreGauges.tsx` の拡張。detail タスク担当）。`completeness.level === 'insufficient'`
  のときは他スコア同様に非表示
- スコア内訳の `<details>` にも「BB参加スコアの内訳」を追加（既存の需給/ファンダと同じ
  `ScoreBreakdown` コンポーネントを再利用。`BbScoreItemOutput[]` を `ScoreItemResult[]` 互換の
  形に変換する薄いアダプタ関数を `detail` タスクが用意する）
- ホームの「スコア上位ピックアップ」は総合スコア（需給+ファンダ平均）のまま変更しない
  （BB参加スコアはBB画面・詳細ページで見る設計。ホームの意味を変えない）
- BB画面（`/bb`）のカードに「BB参加スコア」バッジを追加（§4で詳述）

### テスト観点

- `scoreOfferingRatioBb`: 境界値 9.9/10/19.9/20/29.9/30/49.9/50%
- `scoreUnderwriterTrack`: 母数5件未満はunknown(0点)、5件以上は`breakEvenRate`に応じた段階判定
  （<10%=+2 / <20%=+1 / <30%=0 / <40%=-1 / それ以上=-2、母数0はunknown）
- `scorePriceRangePosition`: checklistの`checkPriceRangeRevision`と同じ境界値でpass/fail/warn/unknownに対応する点数
- `scoreBbParticipation`: 全項目0点設定でも50点に丸まる（ゼロ除算回避、既存 `buildAxis` と同じ方式）

### 受け入れ基準

- 既存 `scoring/scoring.test.ts` は無変更で全通過（既存スコアに影響なし）
- `bb.test.ts` 追加分がすべて通過
- 詳細ページでBB参加スコアが表示され、`insufficient`銘柄では非表示になることを確認

---

## §4. BB戦略ボード

### 目的（投資家フローとの対応）

②「どの口座から申し込むか」③「当選後どうするか」の実務。既存 `/bb` 画面は証券会社別の
ステータス管理のみで「優先順位」「資金拘束の期間重なり」が無い。Phase 2 で申込先の
優先順位付けと、複数銘柄のBB期間が重なったときの資金拘束を可視化する。

### 変更ファイル（bb タスク）

| パス | 変更内容 |
|---|---|
| `src/lib/bb/priority.ts`（新規） | 申込優先順位・資金拘束カレンダーの純関数 |
| `src/lib/bb/priority.test.ts`（新規） | テスト |
| `src/components/BbManagerClient.tsx` | 優先順位セクション・資金拘束カレンダーセクションを追加 |
| `src/components/bb/BrokerPriorityList.tsx`（新規） | 銘柄1件の証券会社優先順位リスト |
| `src/components/bb/FundLockCalendar.tsx`（新規） | 資金拘束カレンダー（期間の重なり表示） |
| `src/components/bb/BbIpoCard.tsx` | BB参加スコアバッジ・優先順位トップ3の強調表示を追加 |

### 型定義・純関数シグネチャ（`src/lib/bb/priority.ts`）

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { IpoEnriched, UnderwriterAllocation } from "@/types/enriched";

/**
 * 証券会社1社の申込優先度スコア（口座選びの参考値。0〜100、高いほど当選期待値が高い目安）。
 * 算出根拠: 主幹事/幹事の配分株数比率（大きいほど当選枠が多い）× 抽選方式の当選しやすさ係数
 * （equal=1.0, point=0.9, proportional=0.7, stage=0.8。根拠: 完全平等・ポイント制は資金力に
 * 依存しないため個人投資家に有利、比例配分は大口優位で不利）× 前受金なしなら+5点ボーナス
 * （資金拘束なく申込めるため実質的な参加障壁が低い）。
 */
export interface BrokerPriorityEntry {
  broker: Broker;
  /** 0〜100の優先度スコア。 */
  priorityScore: number;
  /** 幹事団内での割当株数比率（%）。取得不能なら null。 */
  allocationRatioPercent: number | null;
  /** 主幹事かどうか。 */
  isLead: boolean;
  /** 幹事団に含まれるか（主幹事含む）。含まれない場合は候補外として別扱い。 */
  inSyndicate: boolean;
  reason: string;
}

const LOTTERY_TYPE_COEFFICIENT: Record<Broker["lotteryType"], number> = {
  equal: 1.0,
  point: 0.9,
  stage: 0.8,
  proportional: 0.7,
};

/**
 * 1銘柄について、証券会社ごとの申込優先順位を算出する。
 * allocations が無ければ inSyndicate を underwriters 名寄せのみで判定し、
 * allocationRatioPercent は null のまま、priorityScore は抽選方式係数のみで算出する。
 * 幹事団に含まれない証券会社は結果に含めない。
 * 降順ソート済みで返す（同点は inSyndicate→isLead→名前順）。
 */
export function rankBrokersForIpo(
  ipo: Ipo,
  brokers: Broker[],
  allocations: UnderwriterAllocation[] | undefined,
): BrokerPriorityEntry[];

/** 1件の資金拘束期間（証券会社×銘柄）。 */
export interface FundLockPeriod {
  ipo: Ipo;
  broker: Broker;
  /** 拘束開始日（BB開始日。前受金不要な証券会社は対象外＝呼び出し側でフィルタ）。 */
  start: string;
  /** 拘束終了日（購入期間終了日、無ければ抽選日、無ければBB終了日）。 */
  end: string;
  /** 拘束金額目安（円）。既存 estimatedLockAmount を流用。 */
  amount: number;
}

/**
 * 「申込予定・申込済」ステータスの銘柄×証券会社（前受金が必要な証券会社のみ）について
 * 資金拘束期間の一覧を返す。日付が確定していない項目は除外する。
 */
export function buildFundLockPeriods(
  ipos: Ipo[],
  brokers: Broker[],
  bbState: BbState, // @/types/userData
): FundLockPeriod[];

/** 2つの期間が重なっているか（半開区間 [start, end] の重なり判定）。 */
export function periodsOverlap(a: FundLockPeriod, b: FundLockPeriod): boolean;

/**
 * 同一証券会社内で期間が重なるグループをまとめる（同じ証券会社の資金枠が同時期に
 * 複数銘柄で拘束される＝資金繰りの注意ポイント）。証券会社ごとにグループ配列を返す。
 */
export interface FundLockGroup {
  broker: Broker;
  overlapping: FundLockPeriod[];
  totalAmount: number;
}
export function groupOverlappingLocks(periods: FundLockPeriod[]): FundLockGroup[];
```

`src/lib/bb/*` は新規ディレクトリなので既存の分担表にない。**bb タスク**がそのまま担当する
（BB画面担当と同じタスクが持つ。他タスクとの境界問題は生じない）。

### UI構成: `/bb` 画面のセクション順（投資家フロー②に対応、`BbManagerClient.tsx` 変更）

既存順（サマリ→対象銘柄カード一覧）の後に以下を追加する。銘柄カード（`BbIpoCard`）自体も拡張:

1. **サマリ**（既存 `BbSummary`。変更なし）
2. **資金拘束カレンダー**（新規 `FundLockCalendar`）: `groupOverlappingLocks` の結果、
   `overlapping.length >= 2` の証券会社だけをカードで列挙。見出し「資金拘束の重なり」、
   各カードに証券会社名・重なる銘柄名リスト・期間・合計拘束金額。重なりが0件なら
   セクション自体を非表示（見出しも出さない。空状態は出さない方針＝ノイズにしない）
3. **対象銘柄カード一覧**（既存 `BbIpoCard` 拡張）: 各カードに
   - BB参加スコアバッジ（§3、`insufficient`銘柄は非表示）
   - 証券会社別ステータス行を「優先順位順」に並び替え（`rankBrokersForIpo` の順）
   - 優先度トップの証券会社行に `Chip tone="accent"` で「優先」バッジ（同点なら複数可）
   - 既存のステータス変更UIはそのまま（`BbStatusSelect`）

### 表示文言

- 資金拘束カレンダーの空状態: セクション自体を出さない（上記の通り）
- カードの優先度説明（タップで開く `<details>` または常時1行）: 「幹事配分{比率}%・
  {抽選方式ラベル}」（allocationRatioPercent が null なら「幹事配分 未取得・{抽選方式ラベル}」）
- 抽選方式ラベル: `equal`=完全平等 / `point`=ポイント制 / `stage`=ステージ制 / `proportional`=比例配分
  （`Broker` 型の既存コメントに準拠。新規ラベル定数 `LOTTERY_TYPE_LABELS` を `src/data/brokers.ts`
  に追加してよいか？ → **不可**（brokers.ts は foundation/共有）。`src/lib/bb/priority.ts` 内に
  `LOTTERY_TYPE_LABELS` を定義する）

### テスト観点

- `rankBrokersForIpo`: allocations あり/なし、幹事団に含まれない証券会社が除外される、
  同点時のソート順
- `periodsOverlap`: 境界（end===start は重なりとみなす／隣接は重ならない）
- `groupOverlappingLocks`: 3銘柄が同一証券会社で一部重なる場合のグルーピング
- `buildFundLockPeriods`: `requiresDeposit=false` の証券会社は対象外になること

### 受け入れ基準

- `/bb` 画面で375px時、資金拘束カレンダーのカードが横はみ出しなく表示される
- 優先順位トップの証券会社が視覚的に区別できる（Chipで確認）
- 既存のBBステータス変更機能（localStorage保存）が壊れていない

---

## §5. イベントカレンダー

### 目的（投資家フローとの対応）

④「上場後いつ何を見るか」。既存 checklist（`src/lib/checklist/*`）は詳細ページ内で
フェーズ別チェック項目として既にロック解除・決算・1.5倍ラインを判定しているが、
**複数銘柄を横断した一覧**が無い。ホーム画面の「今後14日の予定」もBB系イベントのみで
上場後イベント（ロック解除・決算・大量保有）を含まない。Phase 2 でこれを横断カレンダーとして追加する。

### 変更・新規ファイル

| パス | 種別 | 役割 |
|---|---|---|
| `src/lib/events/index.ts` | 新規 | 横断イベント収集の純関数（events タスク） |
| `src/lib/events/events.test.ts` | 新規 | テスト |
| `src/app/events/page.tsx` | 新規 | イベントカレンダー画面（Server Component） |
| `src/components/events/EventsClient.tsx` | 新規 | クライアント本体 |
| `src/components/events/EventListItem.tsx` | 新規 | 1件表示 |
| `src/components/nav/BottomTabBar.tsx` | 変更（**integration タスクのみ**） | 6つ目のタブ「予定」を追加 |
| `src/lib/home/index.ts` | 変更（home タスク） | `upcomingEvents` に上場後イベント種別を追加 |

新規タブを追加するため `BottomTabBar.tsx` の変更が必要。これは§7の分担表で「foundation」が
持つ共有ファイルだが、Phase 2ではタブ数が5→6に変わる横断変更のため、**§10のタスク分割で
`integration` タスクに1本化**する（詳細は§10）。

### 型定義・純関数シグネチャ（`src/lib/events/index.ts`）

```typescript
import type { Ipo } from "@/types/ipo";

export type CalendarEventKind =
  | "bbStart"
  | "bbEnd"
  | "allotment"
  | "purchaseStart"
  | "purchaseEnd"
  | "listing"
  | "lockupExpiry"       // 新規: listingDate + lockup.days
  | "priceReleaseWatch"  // 新規: 1.5倍解除条項ありの銘柄で、現在値が公開価格1.4倍到達時点から表示
  | "firstEarnings"      // 新規: firstEarningsDate
  | "largeHoldingReport"; // 新規: largeHoldingReport.date（過去日のみ、直近30日以内の「新着」表示用）

export interface CalendarEvent {
  ipo: Ipo;
  kind: CalendarEventKind;
  date: string; // YYYY-MM-DD
  /** 表示用の1行説明（例: "ロックアップ解除（180日）"）。 */
  detail: string;
}

export const CALENDAR_EVENT_LABELS: Record<CalendarEventKind, string>;

/**
 * 既存 upcomingEvents（home/index.ts）のBB系4種に、上場後3種
 * （lockupExpiry, firstEarnings, priceReleaseWatch）を加えた横断イベント一覧。
 * largeHoldingReport は「過去日程」表示のため別関数 recentLargeHoldingReports に分離する
 * （このカレンダーは「今後の予定」なので過去日は含めない）。
 * days: 対象期間（today起点、既定90日。イベントカレンダー画面は90日、ホームは既存の14日のまま）。
 */
export function upcomingCalendarEvents(
  ipos: Ipo[],
  todayIso: string,
  days?: number,
): CalendarEvent[];

/** ロックアップ解除日イベントを算出（lockup.days>0 かつ listingDate ありのみ）。checklist の addDaysIso と同じ計算式。 */
export function lockupExpiryEvent(ipo: Ipo, todayIso: string): CalendarEvent | null;

/**
 * 1.5倍解除ラインの監視イベント。checklist の checkPriceReleaseLine が warn(1.4倍到達)以上の
 * 状態になったら「本日時点で監視中」として返す（日付は todayIso、期日未確定のため一覧の
 * 先頭近くに出す運用を想定）。pass（まだ距離あり）は含めない。
 */
export function priceReleaseWatchEvent(ipo: Ipo, todayIso: string): CalendarEvent | null;

export function firstEarningsEvent(ipo: Ipo): CalendarEvent | null;

/** 直近30日以内に提出された大量保有報告書（過去日程・"新着"としてカレンダー最上部に別枠表示）。 */
export function recentLargeHoldingReports(ipos: Ipo[], todayIso: string, withinDays?: number): CalendarEvent[];
```

`lockupExpiryEvent` / `priceReleaseWatchEvent` は `src/lib/checklist/items.ts` の
`checkLockupExpiry` / `checkPriceReleaseLine` と判定ロジックが重複するが、戻り値の型が
（ChecklistItem vs CalendarEvent）異なるため、**checklist側は変更せず** events側に
独立実装する（checklist は「表示専用の判定」、events は「日付主体の一覧」という別関心事）。

### UI構成: `/events` 画面

セクション順:
1. 「新着」（`recentLargeHoldingReports`、直近30日）。0件ならセクション非表示
2. 「今後90日の予定」（`upcomingCalendarEvents`、日付昇順）。0件なら
   `EmptyState` 「今後90日以内の予定はありません」

1件の表示（`EventListItem.tsx`）: 日付・イベント種別Chip・銘柄名・1行detail・タップで
詳細ページへ（`Link href="/ipo/${code}"`、44pxタップ領域）。既存 `EventTimeline`
（ホーム用）と見た目は揃えるが、90日分あるため日付ごとに小見出し（`YYYY/MM/DD`）でグルーピング
して表示する（`groupEventsByDate` ヘルパを同ファイル内に追加）。

### ボトムタブの変更（6タブ化、integration タスク）

既存5タブ「ホーム／銘柄／スクリーナー／BB／設定」に「予定」を追加し6タブにする。
375px幅での過密を避けるため、アイコン＋2文字ラベル（例: 「予定」）とし、既存タブの
ラベルもすべて2〜3文字に統一済みであることを確認する（既存確認要: 変更不要ならそのまま）。
`aria-label="メインナビゲーション"` は維持。タブ順序:
`ホーム / 銘柄 / 予定 / BB / スクリーナー / 設定` — 投資家フロー④を強調するため「予定」を
中央寄りに配置し、利用頻度が下がる「スクリーナー」を後方へ移動する。

### 受け入れ基準

- 375pxで6タブが横はみ出しなく表示され、各タブ44px以上のタップ領域を確保
- `/events` の全イベント種別が正しい日付順で表示される
- 既存 `/ipo/[code]` の投資判断チェックリスト（checklist）の表示・判定は変更されていない
- ホームの「今後14日の予定」（既存 `upcomingEvents`）は変更なし、または`upcomingCalendarEvents`
  への統合は行わず据え置き（home タスクの判断で統合してもよいが、その場合はホームの
  表示件数・文言が変わらないことをテストで担保する）

---

## §6. プッシュ通知（Web Push + Workers Cron + KV）

### 目的（投資家フローとの対応）

④「上場後いつ何を見るか」の能動版。イベントカレンダー（§5）は「アプリを開けば見える」が、
BB開始・抽選日・1.5倍ライン接近は**アプリを開かなくても気づきたい**タイミング。ウォッチ中の
銘柄（既存 `watchlist`）に限定して通知する。

### 技術方針（Workers 互換・無料枠のみ）

- **`web-push`（npm）は使わない**: 内部で Node の `crypto`（同期API）に依存しており
  Cloudflare Workers では動作しない。代わりに VAPID 署名（ECDSA P-256, ES256）を
  **Web Crypto API（`crypto.subtle`、Workers で利用可能）で自前実装**する
- ペイロード暗号化（aes128gcm, RFC8291）も `crypto.subtle` で自前実装する。実装量が大きいため
  最小限の1ライブラリ追加を許可する: **`web-push`は不可だが、Workers/Edge互換を謳う軽量な
  VAPID+暗号化ライブラリ（例: `@block65/webcrypto-web-push` のような Workers 対応パッケージ）
  を1つだけ許容**する。ただし実装エージェントは着手前に「Cloudflare Workers 対応」を明記した
  READMEを持つパッケージであることを確認し、`package.json` に追加する前に
  `wrangler dev` 相当（`npm run preview`）で実際に動くことを検証する。動作確認できなければ
  自前実装（`src/lib/push/vapid.ts` に ES256署名、`src/lib/push/encrypt.ts` にaes128gcm）に切り替える
- **KV Namespace** を1つ追加（無料枠: 1日書込1,000/読取100,000/削除1,000、いずれも個人用途で
  十分）。`wrangler.jsonc` に `kv_namespaces` バインディング `PUSH_SUBSCRIPTIONS` を追加
- **Cron Triggers**: `wrangler.jsonc` に `triggers.crons` を追加（無料枠内、Cron自体は課金なし）。
  1日2回（JST 8:00, 20:00 目安）で十分（頻度を上げても実証されたメリットはない）

### 変更ファイル

| パス | 変更 |
|---|---|
| `wrangler.jsonc` | `kv_namespaces`（PUSH_SUBSCRIPTIONS）・`triggers.crons` 追加。**integration タスク**が担当（Cloudflare設定は横断） |
| `package.json` | VAPID鍵は `.env` の `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`（mailto:） |
| `src/app/api/push/subscribe/route.ts`（新規） | 購読登録（POST） |
| `src/app/api/push/unsubscribe/route.ts`（新規） | 購読解除（POST） |
| `src/lib/push/types.ts`（新規） | 型定義 |
| `src/lib/push/vapid.ts`（新規、ライブラリ使用不可時のみ） | VAPID署名の自前実装 |
| `src/components/settings/PushOptIn.tsx`（新規） | 設定画面の通知ON/OFFトグル |
| `public/sw.js` | `push` イベントリスナー追加（**foundation タスク**が担当。既存ファイル） |
| `src/hooks/usePushSubscription.ts`（新規） | Service Worker購読状態のフック |
| `scripts/push/send-notifications.ts`（新規） | Cronから呼ばれる通知送信ロジック |
| `src/app/api/cron/push/route.ts`（新規） | Cron Triggerのハンドラ（Next.js Route Handler経由で`scheduled`イベントを受ける方式はOpenNext仕様に依存するため、下記の実装方式を確認して選ぶ） |

`push` タスクとして独立させる（新規ディレクトリのみを触るため他タスクと衝突しない）。
ただし `wrangler.jsonc`・`public/sw.js` への追記は integration/foundation の担当領域なので、
push タスクは **変更差分をコメントで提示するだけ**にし、実際の書き込みは統合フェーズで行う
（§10 のタスク分割・依存順を参照）。

### Cloudflare Cron Trigger の呼び出し方式（重要な技術確認事項）

`@opennextjs/cloudflare` 構成での Cron Trigger は、Next.js の Route Handler ではなく
Workers の `scheduled` イベントハンドラとして実装する必要がある。実装エージェントは
`node_modules/@opennextjs/cloudflare` の対応状況（`scheduled` export のカスタマイズ方法）を
確認し、以下のいずれかで実装する:

1. `@opennextjs/cloudflare` が `scheduled` ハンドラのカスタムフックを提供していればそれを使う
2. 提供していなければ、`.open-next/worker.js` をラップする薄いカスタムエントリ
   （`wrangler.jsonc` の `main` を差し替えずに済む方法があればそれを優先。無理なら
   `src/app/api/cron/push/route.ts` を作り、**Cron Trigger → 内部fetch → このRoute Handler**
   という「HTTPエンドポイント越し」の間接呼び出しにする。この場合 `wrangler.jsonc` の
   `triggers.crons` に加え、Workers側で `scheduled(event, env, ctx)` から
   `env.WORKER_SELF_REFERENCE.fetch(new Request("https://internal/api/cron/push"))`
   を呼ぶ最小限のラッパが要る（既存 `services.WORKER_SELF_REFERENCE` バインディングを流用できる）

どちらの方式でも `scripts/push/send-notifications.ts` の中身（KVから購読者一覧取得→
条件判定→送信）は共通化できるよう、**Route Handler / scheduled ハンドラの薄い層と、
実処理のロジック層を分離する**（テスト可能にするため）。

### 型定義（`src/lib/push/types.ts`）

```typescript
/** ブラウザの PushSubscription をそのまま保存する形。 */
export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** どの銘柄コードの通知を許可するか。空配列は「ウォッチ全銘柄」を意味する運用にする。 */
  watchedCodes: string[];
  /** 登録日時（ISO）。 */
  createdAt: string;
}

/** KVキーの形式: `sub:<endpointのSHA-256ハッシュ短縮>`。エンドポイントURL自体は長くKVキー制限に
 * 収まらない可能性があるため、ハッシュ化して使う。 */
export function subscriptionKey(endpoint: string): Promise<string>; // crypto.subtle.digest使用

/** 通知の種別。イベントカレンダー（§5）の種別のうち通知に値するもののみ。 */
export type NotificationKind = "bbStart" | "allotmentTomorrow" | "purchaseDeadline" | "lockupExpiry" | "priceReleaseWatch";

export interface NotificationPayload {
  title: string;
  body: string;
  /** 通知タップ時の遷移先。 */
  url: string;
  kind: NotificationKind;
  code: string;
}
```

### `scripts/push/send-notifications.ts` の処理フロー

1. KVから全購読（`PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" })`）を取得
2. `getAllIpos()` で全銘柄取得、`todayIso`（JST）を計算
3. 通知対象イベントを算出: 「明日がBB開始」「明日が抽選日」「本日が購入期限」
   「ロックアップ解除が3日以内」「1.5倍ライン監視に新規到達」の5種（既存 §5 のイベント算出
   関数 `upcomingCalendarEvents` 等を1日分・数日分に絞り込んで再利用する純関数
   `selectNotifiableEvents(events, todayIso)` を `src/lib/push/notify.ts` に新設）
4. 各購読について `watchedCodes`（空なら全銘柄）と一致するイベントのみ通知payload生成
5. VAPID署名付きで送信。**404/410（購読失効）が返ったKVエントリは削除**（購読者側で
   ブラウザ通知が無効化された場合の自然なクリーンアップ）
6. 送信件数・失敗件数をログ出力（Cron結果はダッシュボードのログで確認する運用。専用UI無し）

### UI: 設定画面 `PushOptIn.tsx`（settings タスク担当、§9で配置確定）

- 見出し: 「プッシュ通知」
- iOS Safari の制約を明記: 「iOSではホーム画面に追加後のみ通知を許可できます」
  （`navigator.standalone` または `matchMedia('(display-mode: standalone)')` で判定し、
  非standalone時はトグルをdisabledにして案内文のみ表示）
- トグルON: `Notification.requestPermission()` → 許可されたら
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` →
  `/api/push/subscribe` へPOST
- トグルOFF: `pushManager.getSubscription()` → `unsubscribe()` → `/api/push/unsubscribe` へPOST
- 通知対象銘柄の選択: 「ウォッチリストの銘柄のみ（既定）」固定（v1では全銘柄オプトインは
  作らない。ウォッチ数が増えたときのノイズを避ける設計判断）
- 許可状態の表示: `Notification.permission`（"granted"/"denied"/"default"）をChipで表示
- `denied` のときはブラウザ設定から変更する案内文のみ（機械的に再要求はしない）

### 受け入れ基準

- `.env.example` に `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` を追記（値は空、
  コメントで生成コマンド例を残す）。実キーはコードに書かない
- `npm run preview`（Wrangler ローカル実行）でKVバインディングが解決できることを確認
- 購読登録→Cronロジックの手動実行（`tsx scripts/push/send-notifications.ts --dry-run`
  相当のドライランオプションを用意し、実送信せず対象件数だけログ出力できるようにする）
- iOS standalone判定でトグルの活性/非活性が切り替わることを確認
- Cloudflareの無料枠上限（Cron自体は無料、KV書込1日1000等）を超えない設計であることを
  コメントで明記

---

## §7. セカンダリー分析の深化（自前SVGローソク足）

### 目的（投資家フローとの対応）

④「上場後いつ何を見るか」の可視化強化。既存 `PriceCard` の折れ線スパークライン（終値のみ）
を、詳細ページのセカンダリーフェーズ（checklist の `secondary` フェーズ該当銘柄）でのみ
ローソク足＋25日移動平均＋出来高に拡張する。**チャートライブラリは追加しない**（自前SVG）。

### 変更・新規ファイル

| パス | 種別 | 役割 |
|---|---|---|
| `src/components/detail/CandleChart.tsx` | 新規 | ローソク足＋MA25＋出来高の自前SVG（detail タスク） |
| `src/lib/chart/candle.ts` | 新規 | 座標計算・MA計算の純関数（detail タスク管理下の新規ファイル） |
| `src/lib/chart/candle.test.ts` | 新規 | テスト |
| `src/app/api/quote/[code]/route.ts` | 変更 | 120日→180日分に延長し、`open/high/low/close/volume` を返すよう拡張（**foundation タスク**、既存ファイル） |
| `src/lib/quote.ts` | 変更 | `QuoteResponse` 型にOHLCV追加（**data タスク**、既存ファイル） |
| `src/components/detail/PriceCard.tsx` | 変更 | セカンダリーフェーズのときのみ `CandleChart` を追加表示（**detail タスク**、既存ファイル） |

### `/api/quote/[code]` の拡張（foundation タスク、既存ファイル変更）

現状 `chart(...)` の返却から `close` のみ使っているが、`open/high/low/volume` も
既にAPIレスポンスに含まれている（yahoo-finance2の`chart`が返す）。変更は
「取得期間を120日→180日」「レスポンス型にOHLCVを追加」の2点のみ。既存の
`{code, price, prevClose, changePct, closes:[{date, close, volume}], updatedAt}` は
後方互換のため維持し、`closes` の各要素に `open/high/low` を追加する形にする
（フィールド追加のみで既存フィールド削除なし）。

```typescript
// src/lib/quote.ts の QuoteResponse（変更、data タスク）
export interface QuoteClosePoint {
  date: string;
  open: number;   // 追加
  high: number;   // 追加
  low: number;    // 追加
  close: number;
  volume: number;
}
export interface QuoteResponse {
  code: string;
  price: number;
  prevClose: number;
  changePct: number;
  closes: QuoteClosePoint[];
  updatedAt: string;
}
```

### 型定義・純関数シグネチャ（`src/lib/chart/candle.ts`）

```typescript
export interface CandlePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 単純移動平均（25日）。データ不足箇所は null（先頭24件など）。 */
export function movingAverage25(points: CandlePoint[]): (number | null)[];

export interface CandleLayout {
  /** ローソク1本のx座標（中心）。 */
  x: number;
  /** 実体（open-close）の矩形。 */
  bodyY: number;
  bodyHeight: number;
  /** ヒゲの上端・下端y座標。 */
  wickY1: number;
  wickY2: number;
  /** 陽線か陰線か（close >= open で陽線）。 */
  isUp: boolean;
}

/**
 * 価格レンジ（全期間のhigh/low）をチャート領域の高さにマッピングし、
 * 各ローソクの描画座標を計算する純関数。SVG生成そのものはコンポーネント側で行う
 * （このファイルは座標計算のみでReact/DOMに依存しない。テストしやすくするため）。
 */
export function layoutCandles(
  points: CandlePoint[],
  chartWidth: number,
  chartHeight: number,
): CandleLayout[];

/** 出来高バーの高さ（0〜volumeAreaHeight）を、期間内最大出来高比でスケーリング。 */
export function layoutVolumeBars(
  points: CandlePoint[],
  chartWidth: number,
  volumeAreaHeight: number,
): number[]; // 各バーの高さ（px）
```

### UI: `CandleChart.tsx`

- 表示条件: `determinePhase(ipo, todayIso) === "secondary"` のときのみ `PriceCard` 内に追加
  表示（BB申込・上場当日フェーズでは日足データが薄いか無いため非表示。既存 `checklist`
  の `determinePhase` をそのままimportして使う）
- レイアウト: 上段にローソク足＋MA25の折れ線（`polyline`、既存 `Sparkline` と同じ
  `var(--up)/var(--down)` トークン）、下段に出来高バー（高さ比率 7:3程度）
- 公開価格ライン・初値ラインを水平の破線（`stroke-dasharray`）で重ねる。凡例は
  チャート下に小さく「– 公開価格」「– 初値」（Chipではなく`<span>`＋色付き線分アイコン）
- 陽線=`var(--up)`、陰線=`var(--down)`、出来高バーも同色（陽線日=up色、陰線日=down色）
- データ不足（2件未満）時: 何も描画しない（既存 `Sparkline` と同じ規約）
- 375px幅での表示: `viewBox` を使い横スクロールなしで全期間を圧縮表示（1本あたりの
  幅は自動計算、最小1px以上を保証。180本を375px内に収めるため個々のローソクは細くなるが
  それでよい。詳細を見たいユーザー向けに「タップで拡大」等のインタラクションは v1 では作らない
  ＝スコープ外、必要なら将来案として§14に書く）

### テスト観点

- `movingAverage25`: 24件目まではnull、25件目から計算される
- `layoutCandles`: 全て同値（high=low=open=close）のときゼロ除算しない
- `layoutVolumeBars`: 出来高0件が混在する期間でも高さが負にならない
- `CandleChart` のスナップショット的検証は不要（純関数のテストのみで十分、コンポーネントは
  detail タスクの手動確認＝§13の375px/1280px検証で担保）

### 受け入れ基準

- BB申込・上場当日フェーズの詳細ページでは表示されない（既存チェックリストのフェーズ判定と
  整合）
- セカンダリーフェーズかつ日足2件以上ある銘柄でローソク足が表示される
- 375px幅で横スクロール・はみ出しが発生しない
- チャートライブラリが `package.json` に追加されていないこと（grep確認）

---

## §8. ホーム画面のセクション順再設計

### 現状 → Phase 2 後の並び

投資家フロー①〜④に沿って並べ替える。現状の各セクションは維持しつつ、順序と新規セクションを
以下のように確定する（`HomeClient.tsx` の変更。**home タスク**が担当）。

| 順 | セクション | 変更内容 | 対応フロー |
|---|---|---|---|
| 1 | 見出し・免責注記 | 変更なし | — |
| 2 | 地合いカード（`SentimentBanner`） | 変更なし | ①②③④共通の前提情報 |
| 3 | サマリー（KPI4枚） | 変更なし | 市場全体の実績把握 |
| 4 | **BB参加候補ハイライト**（新規セクション） | §3のBB参加スコア上位3件を表示。既存の
     「需給ハイライト」を置き換えるのではなく、**その前に追加**する | ① |
| 5 | 今後14日の予定（`EventTimeline`） | 変更なし。ただし見出し下の1行に
     「上場後の予定は『予定』タブでまとめて確認できます」を追記（§5の新タブへの導線） | ④ |
| 6 | スコア上位ピックアップ（`TopPicks`、既存） | 変更なし（総合スコア＝需給+ファンダ、
     BBスコアとは別物であることが分かるよう見出し脇の note 文言を
     「総合スコア（需給・ファンダ）の機械的な上位」に微調整 | 銘柄探索全般 |
| 7 | 需給ハイライト（`SupplyDemandHighlights`、既存） | 変更なし | 銘柄探索全般 |
| 8 | 免責（`Disclaimer`） | 変更なし | — |

### 新規セクション「BB参加候補ハイライト」の実装

`src/lib/home/index.ts` に純関数を追加（home タスク）:

```typescript
export interface BbHighlightItem {
  ipo: Ipo;
  bbScore: number; // BbScoreResult.score
}

/**
 * BB参加スコア上位3件。対象は status が upcoming/bb_open/priced のみ
 * （listed銘柄はBB参加の意味がないため除外）。completeness が insufficient の銘柄は除外。
 * 呼び出し側（HomeClient）が scoreBbParticipation を事前計算して渡す設計にし、
 * この関数はソート・フィルタのみを担う（scoring への依存はコンポーネント層に閉じる）。
 */
export function topBbCandidates<T extends BbHighlightItem>(
  scored: T[],
  n?: number,
  completenessFn?: (ipo: Ipo) => CompletenessResult,
): T[];
```

UIコンポーネント `src/components/home/BbCandidates.tsx`（新規、home タスク）は既存
`TopPicks.tsx` とほぼ同型（`IpoCard` を使い、スコアピルの代わりにBB参加スコアのみ表示する
軽量版が必要なら `IpoCard` に `bbScore?: number` propを追加してBB専用バッジを出す拡張を
**foundation タスク**に依頼する。もしくは v1では既存 `ScorePill` を流用し「BB参加」ラベルで
表示するだけに留めてよい＝`IpoCard` 変更なしで実装可能なため、後者を採用する）。

- 見出し: 「BB参加候補」
- note: 「BB参加スコア（吸収金額・OR・主幹事実績等の機械的集計）の上位。参考情報です」
- 0件時: `EmptyState`「現在BB受付中・受付前で条件一致の銘柄はありません」

---

## §9. 詳細ページのセクション順再設計

### 現状 → Phase 2 後の並び

投資家フロー①〜④の順で並べ替える（`IpoDetailClient.tsx` の変更。**detail タスク**が担当）。

| 順 | セクション | 状態 | 対応フロー |
|---|---|---|---|
| 1 | ヘッダー（名前・コード・ウォッチ星・未取得チップ） | 既存維持 | — |
| 2 | 価格（`PriceCard`。セカンダリー時は§7のローソク足も内包） | 既存維持＋拡張 | ④の一部（現在値） |
| 3 | **類似条件の初値実績**（`OutcomeDistribution`、新規） | 新規追加 | ③ |
| 4 | スコア（4ゲージ: 需給・ファンダ・**BB参加**（新規）・総合） | 既存＋BB軸追加 | ①③ |
| 5 | スコア内訳（`<details>` 3種→4種、BB参加スコア内訳を追加） | 既存＋拡張 | ①③ |
| 6 | 基本情報（`BasicInfoList`） | 既存維持 | ①② |
| 7 | **幹事団と申込優先順位**（新規、§4のロジックを詳細ページにも表示） | 新規追加 | ② |
| 8 | 日程（`Timeline`） | 既存維持 | ①④ |
| 9 | BB申込状況（`BbStatusList`） | 既存維持 | ② |
| 10 | 投資判断チェックリスト（`InvestmentChecklist`） | 既存維持 | ①④ |
| 11 | 類似IPO（`SimilarIpos`） | 既存維持 | ③の補助 |
| 12 | メモ（`NotesEditor`） | 既存維持 | — |

### 新規セクション「幹事団と申込優先順位」（detail タスク）

`src/components/detail/UnderwriterPriority.tsx`（新規）。§4 の `rankBrokersForIpo` を
そのまま呼び出し、証券会社ごとの優先順位・配分比率・抽選方式を `ListRow` 形式で列挙する
（`/bb` 画面のカード内表示と同じロジックを共有するが、詳細ページでは全証券会社を常時表示し、
折りたたみはしない）。データが無い（`allocations` 未取得）場合は「幹事団の配分情報は
未取得です。主幹事: {leadUnderwriter}」の1行のみ表示。

見出し: 「幹事団と申込優先順位」。note: 「幹事配分×抽選方式から算出した参考順位です」

### `IpoDetailClient.tsx` の変更点まとめ

- import追加: `OutcomeDistribution`, `UnderwriterPriority`
- `scoreBbParticipation` の呼び出し追加（`underwriterBreakEvenStat` を事前計算して渡す。
  `allIpos` は `IpoDetailClient` の新規 prop として受け取る必要がある → **ページ側
  `src/app/ipo/[code]/page.tsx` の変更が必要**（`getAllIpos()` は既に呼んでいるので
  `allIpos` prop を追加するだけ。この1ファイルは既存の分担表にないページなので
  **detail タスク**がそのまま担当してよい）
- `ScoreGauges` に4本目のゲージを渡す（§3のUI仕様）

---

## §10. 実装タスク分割（並列実装用）

### 原則

`scratch/mobile-design.md` §7 の Phase 1 分担表を踏襲し、共有ファイル（`src/types/*`,
`src/lib/merge.ts`, `src/lib/repository.ts`, `package.json`, `wrangler.jsonc`,
`src/app/ipo/[code]/page.tsx`, `IpoDetailClient.tsx`, `HomeClient.tsx`,
`BbManagerClient.tsx`, `BottomTabBar.tsx` 等）は **foundation** か **integration** の
単一タスクだけが触る。他タスクはこれらを読み取り専用で参照し、変更が必要なら
「共有変更依頼」として当該タスクの成果物に明記する（実際の変更は integration タスクが
最後にまとめて反映する）。

依存順は「foundation-p2（型・merge基盤）」→「各データ/ロジックタスク（並列）」→
「各UIタスク（並列、ロジックタスクの型を読み取り専用で使う）」→「integration（横断結線・
共有ファイル反映・タブ変更・wrangler設定）」の4段階。

### タスク一覧

| タスクID | 担当節 | 触ってよいファイル | 他タスクへ公開するインターフェース | 依存順 |
|---|---|---|---|---|
| **foundation-p2** | §1（型・merge基盤）、§7（quote API拡張） | `src/types/enriched.ts`（新規）／`src/lib/merge.ts`（`mergeIpos`シグネチャ変更・`applyEnriched*`追加）／`src/app/api/quote/[code]/route.ts`（OHLCV拡張） | `IpoEnriched`型、`mergeIpos(base, enriched, auto)`、`applyEnriched`、quote APIの新レスポンス形 | 0（最初） |
| **data-p2** | §1（enrichスクリプト・repository拡張） | `scripts/enrich/*`（新規一式）／`public/data/ipos.enriched.json`（新規）／`src/lib/repository.ts`（enriched追加）／`src/lib/quote.ts`（OHLCV型追加） | `getEnrichedByCode`, `findEnriched`, 拡張済み`IpoDataSet`, 拡張済み`QuoteResponse` | 1（foundation-p2待ち：`IpoEnriched`型・`mergeIpos`新シグネチャが必要） |
| **stats-p2** | §2 | `src/lib/stats/*`（新規一式） | `outcomeDistributionByAbsorptionBand`, `underwriterBreakEvenStat(s)`, `offeringRatioBandStats`, 各Band型・ラベル | 0（`Ipo`型のみ依存、既存で足りる。並列可） |
| **scoring-p2** | §3 | `src/lib/scoring/bb.ts`, `src/lib/scoring/bb.test.ts`（新規のみ。既存`scoring/*`は読み取り専用） | `scoreBbParticipation`, `BbScoreResult`, `DEFAULT_BB_WEIGHTS`, `BB_SCORE_ITEM_LABELS` | 1（stats-p2の`UnderwriterBreakEvenStat`型待ち） |
| **bb-p2** | §4 | `src/lib/bb/*`（新規一式）／`src/components/bb/BrokerPriorityList.tsx`／`src/components/bb/FundLockCalendar.tsx`／`src/components/bb/BbIpoCard.tsx`（拡張） | `rankBrokersForIpo`, `buildFundLockPeriods`, `groupOverlappingLocks`, `LOTTERY_TYPE_LABELS` | 2（foundation-p2の`IpoEnriched`、data-p2の`getEnrichedByCode`、scoring-p2のBBスコア型待ち） |
| **events-p2** | §5 | `src/lib/events/*`（新規一式）／`src/app/events/page.tsx`（新規）／`src/components/events/*`（新規） | `upcomingCalendarEvents`, `CalendarEvent`, `CALENDAR_EVENT_LABELS` | 0（既存`Ipo`型・`checklist`ロジック参照のみ。並列可） |
| **push-p2** | §6 | `src/lib/push/*`（新規一式）／`src/app/api/push/*`（新規）／`src/components/settings/PushOptIn.tsx`（新規）／`src/hooks/usePushSubscription.ts`（新規）／`scripts/push/*`（新規） | `StoredSubscription`, `selectNotifiableEvents`, VAPID関連関数 | 1（events-p2の`upcomingCalendarEvents`待ち。`wrangler.jsonc`/`public/sw.js`実配線はintegration待ち） |
| **detail-p2** | §3 UI, §4 UI（詳細ページ分）, §7 UI, §9 | `src/components/detail/OutcomeDistribution.tsx`（新規）／`src/components/detail/UnderwriterPriority.tsx`（新規）／`src/components/detail/CandleChart.tsx`（新規）／`src/lib/chart/*`（新規）／`src/components/detail/ScoreGauges.tsx`（既存拡張）／`src/components/detail/PriceCard.tsx`（既存拡張） | — | 3（stats-p2, scoring-p2, bb-p2, foundation-p2 全て待ち） |
| **home-p2** | §8 | `src/components/home/BbCandidates.tsx`（新規）／`src/lib/home/index.ts`（`topBbCandidates`追加、既存拡張） | `topBbCandidates`, `BbHighlightItem` | 1（scoring-p2待ち） |
| **integration-p2** | 横断結線 | `src/components/IpoDetailClient.tsx`／`src/components/home/HomeClient.tsx`／`src/components/BbManagerClient.tsx`／`src/components/nav/BottomTabBar.tsx`／`src/app/ipo/[code]/page.tsx`／`wrangler.jsonc`／`public/sw.js`／`package.json`（依存追加の最終反映） | — | 4（最後。全タスク完了後にまとめて配線） |

### 依存グラフ（テキスト）

```
foundation-p2 ─┬─→ data-p2 ─┬─→ bb-p2 ──────────────┐
               │            │                         │
               └─→ (quote拡張は detail-p2 が直接利用) │
stats-p2 ──────────────────┴─→ scoring-p2 ──┬─→ bb-p2 (上と合流)
                                              ├─→ home-p2
                                              └─→ detail-p2
events-p2 ─────────────────────────────────────────┬─→ push-p2
                                                      └─→ detail-p2は不使用（§9では未使用、§5画面はevents-p2が完結）

bb-p2, scoring-p2, stats-p2, foundation-p2, data-p2 ──→ detail-p2 ──┐
home-p2, bb-p2, events-p2, push-p2, detail-p2 ──────────────────────┴─→ integration-p2
```

実務上は「foundation-p2 と stats-p2 と events-p2 を最初に並列着手」→
「data-p2 と scoring-p2 を次に並列着手」→「bb-p2 と home-p2 と push-p2 を並列着手」→
「detail-p2」→「integration-p2」の5波で進めるのが最も並列度が高い。

### タスクごとの完了定義（Definition of Done）

各タスクは自分の担当ファイルの範囲で以下を満たしてから次段へ引き渡す:

- 新規追加した純関数はすべてテスト付き（`npx vitest run <対象ファイル>` が通過）
- `npx tsc --noEmit` が自分の変更ファイル範囲でエラーを出さない（他タスク未着手ファイルへの
  参照で発生するエラーは許容し、コメントで「〇〇タスク完了後に解消見込み」と明記してよい）
- 公開インターフェース（上表）は設計書記載のシグネチャと一致させる（変更が必要になった場合は
  他タスクへの影響を洗い出してから変更する）
- 共有ファイルへの変更が必要になった場合は、そのファイルを直接編集せず
  「integration-p2 への変更依頼」として自分の成果物末尾にコード差分（diff相当）を書き残す

---

## §11. テスト観点まとめ（各節の詳細を横断整理）

新規テストファイル一覧（既存テストは変更しない。既存154件は全通過を維持）:

| ファイル | 主な観点 |
|---|---|
| `scripts/enrich/parse96ut.test.ts` | 価格レンジ/BB期間の文字列パース、コード抽出、寛容なフィールド欠落処理 |
| `src/lib/merge.test.ts`（既存拡張） | `applyEnriched`の埋め規則、`mergeIpos`新シグネチャの後方互換（enriched空配列） |
| `src/lib/completeness.test.ts`（既存、変更不要） | enriched適用後もinsufficient判定ロジック自体は不変（入力データが変わるだけ） |
| `src/lib/stats/stats.test.ts` | 帯の境界値、母数0のnull、中央値偶数/奇数、winRate計算 |
| `src/lib/scoring/bb.test.ts` | 各項目の境界値、母数不足時のunknown、ゼロ除算回避 |
| `src/lib/bb/priority.test.ts` | 優先順位ソート、期間重なり判定、資金拘束フィルタ |
| `src/lib/events/events.test.ts` | ロック解除日計算、1.5倍ライン監視、大量保有の30日窓 |
| `src/lib/chart/candle.test.ts` | MA25の欠落範囲、ゼロ除算回避 |
| `src/lib/push/notify.test.ts` | 通知対象イベントの選定（明日開始/本日期限等の境界） |
| `src/lib/home/home.test.ts`（既存拡張） | `topBbCandidates`のフィルタ・ソート |

## §12. 受け入れ基準（Phase 2 全体）

各節の個別基準に加え、Phase 2 全体としての基準:

- 投資家フロー①〜④が画面遷移なしで追える動線になっている（ホーム→詳細で①③が見える、
  `/bb`で②が見える、`/events`と通知で④が見える）
- 96ut補完後、JPX発見銘柄40件のうち `insufficient` のままの件数が減っている
  （96utに記事が存在しない銘柄は仕方なく残る。0件化は目標にしない）
- BB参加スコアの重み初期値が `report.md` の実証内容とセクション対応表（§3）で説明できる
  （実装後、重みの根拠を尋ねられたら本設計書を示せる状態）
- 新規依存は「Workers互換のVAPID/Web Pushライブラリ1つ」のみ（それ以外はゼロ）。
  `package.json` の diff で確認する
- チャートライブラリが追加されていない（`package.json` grep）

## §13. 検証手順（納品ゲート。`scratch/mobile-design.md` §8 を Phase 2 分に拡張）

実装完了後、integration-p2 が以下を実行する:

1. `npx tsc --noEmit` エラー0
2. `npm run lint` エラー0
3. `npm test` 全通過（既存154件＋新規追加分すべて）
4. `npm run build` 成功
5. `npm run preview`（Wrangler ローカル）でKVバインディング・quote API拡張・Cron設定
   （手動実行）が解決できることを確認
6. 375px・1280pxで全ルート（既存7ルート＋新規 `/events`）の
   `document.documentElement.scrollWidth <= window.innerWidth`
7. ボトムタブが6つになった状態で各リンク高さ≥44px、`aria-current="page"`維持
8. 禁止語 grep（`scratch/mobile-design.md` §6 と同一リスト）src配下ゼロ
9. `git diff --stat public/data/ipos.base.json public/data/ipos.auto.json` で
   既存2ファイルが変更されていないこと（enrichedは新規ファイルとして追加のみ）
10. localStorage キーが5つ（既存4つ＋`ipo-analyzer:theme:v1`）から増えていないこと
    （新機能はすべて既存キー内の構造拡張、または新規キーなら`ipo-analyzer:<name>:v1`形式で
    かつ増分を本人へ報告する）

## §14. 設計メモ（将来案、Phase 2 スコープ外）

Phase 2 の8〜10（本人判断待ち）について、実装しない前提で方向性のみ記す。

**8. クラウド同期（Cloudflare D1）**: 現状 localStorage 完結のユーザーデータ（ウォッチ・BB
状況・メモ）を複数端末間で同期したい場合、D1（SQLite互換、無料枠あり）に移行する案がある。
ただし認証機構（誰のデータか識別する仕組み）が新たに必要になり、個人用ツールの現在の
シンプルさを大きく損なう。本人が「複数端末で使いたい」と明確に感じたタイミングで
再検討するのがよく、Phase 2 では手を付けない。

**9. ネイティブ化（Capacitor `cap add ios/android`）**: `capacitor.config.ts` の準備は
Phase 1 で完了済み。実際の `cap add` には Xcode/Android Studio のローカル環境が要り、
ストア公開には開発者登録・審査対応も伴う。PWA（ホーム画面追加）で通知含め大半の体験が
賄える現状、ネイティブ化の優先度は低い。本人が「オフラインでの安定動作」「ストア経由の
配布」を明確に必要とした時点で着手するのがよい。

**10. M1夜間ジョブ化**: `npm run update:data`・`npm run enrich:data` を毎日決まった時刻に
自動実行したい場合、既存の m1-server 運用（`~/.claude/rules/m1-server.md`）に乗せる形が
自然。Cloudflare Cron（§6のプッシュ通知用に導入済み）に同居させる案もあるが、
JPX/96ut/Yahoo Financeへのスクレイピングは実行時間が数分単位でCronの実行時間制限
（Workers無料枠は1回あたりのCPU時間に上限あり）に収まらない可能性があるため、
データ取得系はM1（自前サーバー、時間制限なし）で回し続け、Cronは「軽量な通知送信のみ」に
役割を絞るのが安全。本人の運用希望（M1常時稼働の可否）を確認してから着手する。

---

以上。
