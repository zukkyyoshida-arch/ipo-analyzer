# Apollo IPO Phase 2 設計書（データ品質・実証優先レンズ）

作成日: 2026-09-25 / 実装エージェントはこの文書「だけ」読めば実装できる粒度で書く。判断に迷ったら
`scratch/mobile-design.md` の3原則（スマホで片手UI／投資助言と誤解されない文言／データが無い項目は正直に「未取得」）
と `scratch/phase2/context.md` の「本人裁定・規律」を優先する。

## 0. 全体方針（レンズ: データ品質・実証優先）

- **正直な未取得表示が最優先**。取れないものを取れたフリで埋めない。すべての新規取得値に `sourceUrl` と `fetchedAt` を持たせる。
- **96ut スクレイパーは壊れる前提で作る**。行ラベルの表記揺れ・404・構造変化を検知して安全側（スキップ＋警告ログ）に倒す。フィクスチャHTMLをテストに固定化し、パーサ変更の退行を機械的に検出する。
- **新しいスコア重みは実装前に `scratch/backtest/` で検証する**（本人裁定）。本書はバックテスト手順を明文化し、Phase 2 の重み変更はその結果を根拠にする。
- 禁止語・localStorage キー不変・既存ファイル削除禁止は全タスク共通の制約（§9 参照）。

---

## 1. 新規/変更ファイル一覧

### 1.1 型定義（新規・変更）

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/types/enriched.ts` | 新規 | `IpoEnriched` 型（96ut 由来の拡張フィールド、出典・取得日時つき） |
| `src/types/ipo.ts` | 変更（追記のみ） | `Ipo` に Phase2 拡張フィールドを**すべて任意**で追加（既存必須フィールドは変更しない） |
| `src/types/data.ts` | 変更（追記のみ） | なし（`IpoBase = Ipo` のままなので自動追従。コメント更新のみ） |
| `src/types/broker.ts` | 変更（追記のみ） | `Broker` に `allocationHint`（配分傾向の目安、任意）を追加しない※ → §4 参照、型変更なしで対応 |
| `src/types/push.ts` | 新規 | Web Push 購読の型（KV保存用） |

### 1.2 データ取得・変換

| ファイル | 種別 | 概要 |
|---|---|---|
| `scripts/updater/kabu96ut.ts` | 新規 | 96ut スクレイパー本体（1銘柄1ページ取得＋パース） |
| `scripts/updater/kabu96ut.test.ts` | 新規 | フィクスチャHTMLを使ったパーサのユニットテスト |
| `scripts/updater/__fixtures__/kabu96ut/*.html` | 新規 | 保存済み実ページHTML（正常系1〜2件・行ラベル揺れ版1件） |
| `scripts/updater/kabu96ut-discover.ts` | 新規 | 記事番号一覧の発見（カテゴリ一覧 or サイトマップ） |
| `scripts/updater/main.ts` | 変更（updaterタスクのみが触る） | enriched 取得ステップを追加 |
| `public/data/ipos.enriched.json` | 新規（updater が生成） | 96ut 由来の拡張データ（配列） |
| `src/lib/merge.ts` | 変更（foundation/integration のみ） | `mergeIpos` を3層化（base＞enriched＞auto） |

### 1.3 統計・実績

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/lib/stats/initialReturnStats.ts` | 新規 | 吸収金額帯×市場×地合い別の初値騰落率分布、主幹事別公募割れ率、OR帯別統計の純関数 |
| `src/lib/stats/initialReturnStats.test.ts` | 新規 | 統計関数のテスト |
| `src/components/detail/SimilarIpoStats.tsx` | 新規 | 詳細ページ「類似IPOの実績」セクション |
| `src/app/stats/page.tsx` | 新規 | 統計専用ページ（任意タブからの導線。ボトムタブは増やさず`/screener`等からリンク） |
| `src/components/stats/StatsClient.tsx` | 新規 | 統計ページ本体 |

### 1.4 スコア再校正

| ファイル | 種別 | 概要 |
|---|---|---|
| `scratch/backtest/recalibrate.py` | 新規 | 初値騰落率を目的変数にしたバックテスト・重み検証スクリプト |
| `scratch/backtest/report-phase2.md` | 新規（バックテスト実行後に作成） | 検証結果と新重みの根拠 |
| `src/lib/scoring/weights.ts` | 変更（バックテスト結果を反映、foundation/integrationのみ触る） | `supplyDemand` プリセットの数値更新（バックテストで実証された場合のみ） |

### 1.5 BB戦略ボード

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/lib/bb/priority.ts` | 新規 | 申込先優先順位づけの純関数（幹事配分×抽選方式×前受金） |
| `src/lib/bb/priority.test.ts` | 新規 | テスト |
| `src/lib/bb/fundLock.ts` | 新規 | 口座別資金拘束（期間の重なり）計算の純関数 |
| `src/lib/bb/fundLock.test.ts` | 新規 | テスト |
| `src/components/bb/BbPriorityBoard.tsx` | 新規 | 優先順位ボードUI |
| `src/components/bb/BbFundCalendar.tsx` | 新規 | 資金拘束カレンダーUI |
| `src/components/BbManagerClient.tsx` | 変更（bb タスクのみ） | 上記2コンポーネントをセクション追加 |

### 1.6 イベントカレンダー

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/lib/events/index.ts` | 新規 | ロックアップ解除日・1.5倍条項判定・決算発表日・大量保有をイベント配列化する純関数 |
| `src/lib/events/index.test.ts` | 新規 | テスト |
| `src/app/events/page.tsx` | 新規 | イベントカレンダー専用ページ |
| `src/components/events/EventsClient.tsx` | 新規 | イベント一覧UI |
| `src/components/nav/BottomTabBar.tsx` | **変更しない**（タブは5つのまま。`/events`は`/ipos`または設定からの導線リンクとして提供） | — |

### 1.7 プッシュ通知

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/types/push.ts` | 新規（1.1で既出） | 購読レコード型 |
| `src/app/api/push/subscribe/route.ts` | 新規 | 購読登録（KVへ書込） |
| `src/app/api/push/unsubscribe/route.ts` | 新規 | 購読解除 |
| `src/lib/push/vapid.ts` | 新規 | VAPID鍵読込ヘルパ（`.env` から） |
| `src/components/settings/PushSubscribeToggle.tsx` | 新規 | 設定画面のプッシュ通知トグル |
| `public/sw.js` | 変更（foundation担当のみ） | `push` イベントリスナー追加 |
| `wrangler.jsonc` | 変更（integration担当のみ、要本人確認） | KV namespace binding 追加、Cron Triggers 追加 |
| `scripts/push/send-daily.ts` | 新規 | Cron から呼ぶ通知送信スクリプト（Workers Cron Trigger経由） |

### 1.8 セカンダリー分析

| ファイル | 種別 | 概要 |
|---|---|---|
| `src/components/detail/CandleChart.tsx` | 新規 | 自前SVGローソク足＋25日MA＋出来高（依存ライブラリなし） |
| `src/components/detail/PriceCard.tsx` | 変更（detail タスクのみ） | 6ヶ月チャートへのリンク/切替を追加 |
| `src/app/api/quote/[code]/route.ts` | 変更（foundation/integrationのみ） | lookback を120日→180日に拡張するオプション追加（既存の動作は変えない） |

---

## 2. 型定義

### 2.1 `src/types/enriched.ts`（新規）

```typescript
// 96ut.com 由来の拡張データ型。取得できたフィールドのみ持つ部分レコード。
// すべての数値・日付フィールドに出典 URL と取得日時を必ず添える
// （データ品質・実証優先の方針: 「未取得」を隠さず、根拠を追跡可能にする）。

/** 1件の取得元情報。同じ値でも項目ごとに出典が異なりうるため個別に持つ。 */
export interface SourceRef {
  url: string;
  /** ISO 日時。この値をいつ読んだか。 */
  fetchedAt: string;
}

/** 大株主1件。 */
export interface MajorHolder {
  name: string;
  shares: number;
  /** 発行済株式に対する割合（%） */
  ratio: number;
  /** ロックアップ日数（個別設定がある場合）。無ければ null（全体のlockup.daysに従う） */
  lockupDays: number | null;
}

/** 幹事団1社の配分。 */
export interface UnderwriterAllocation {
  name: string;
  /** 割当株数。取得できなければ null */
  shares: number | null;
  /** 割当比率（%）。取得できなければ null */
  ratio: number | null;
}

/** 会社概要（96utの「会社概要」テーブル）。 */
export interface CompanyProfile {
  address: string | null;
  established: string | null;
  employeeCount: number | null;
  auditor: string | null;
}

/** 業績テーブルの1期分。 */
export interface FinancialPeriod {
  /** 決算期（例: "2025年12月期"） */
  period: string;
  /** 売上高（百万円）。取得できなければ null */
  revenue: number | null;
  /** 経常利益（百万円）。取得できなければ null */
  ordinaryProfit: number | null;
  /** 当期利益（百万円）。取得できなければ null */
  netProfit: number | null;
  /** 売上高変化率（%）。取得できなければ null */
  revenueChangePct: number | null;
}

/**
 * 96ut から取得した1銘柄分の拡張データ。
 * code は必須。他はすべて任意 + 値がある場合は対応する `*Source` に出典を持つ。
 * merge.ts はこのうち「取得できたフィールドのみ」base の上に重ねる
 * （手動 base の値がある場合は base を優先し、enrichedでは埋めない。§3参照）。
 */
export interface IpoEnriched {
  code: string;

  // --- BB・スケジュール（Ipo.bbPeriod 等と同じ形） ---
  bbPeriod?: { start: string; end: string };
  allotmentDate?: string;
  purchasePeriod?: { start: string; end: string };
  priceRangeDecisionDate?: string;

  // --- 価格・株数 ---
  assumedPrice?: number;
  priceRange?: { low: number; high: number };
  offeringPrice?: number | null;
  publicShares?: number;
  saleShares?: number;
  overAllotment?: number;
  issuedShares?: number;
  absorptionAmountAssumed?: number;
  absorptionAmountOffering?: number;
  absorptionAmountInitial?: number | null;
  offeringRatio?: number;
  marketCap?: number;

  // --- 幹事・引受 ---
  leadUnderwriter?: string;
  underwriterAllocations?: UnderwriterAllocation[];

  // --- 会社概要・業績 ---
  companyProfile?: CompanyProfile;
  financialHistory?: FinancialPeriod[];
  eps?: number | null;
  bps?: number | null;
  dividendPerShare?: number | null;

  // --- 株主・ロックアップ ---
  majorHolders?: MajorHolder[];
  existingShareholderLockupShares?: number | null;
  existingShareholderLockupCoverage?: number | null;
  vcEstimatedHoldingRatio?: number | null;
  vcEstimatedLockupRatio?: number | null;
  stockOptionShares?: number | null;

  // --- メタ ---
  /** フィールドごとの出典。キーは上記フィールド名。 */
  sources: Partial<Record<string, SourceRef>>;
  /** このレコード全体の取得日時（フォールバック用）。 */
  fetchedAt: string;
  /** 取得元記事URL。 */
  articleUrl: string;
}
```

### 2.2 `src/types/ipo.ts`（既存ファイルへの**追記のみ**。既存フィールドは一切変更しない）

`Ipo` インターフェースの末尾（既存の `largeHoldingReport?` の後）に以下を追加する。すべて `?:` の任意フィールドなので既存の全 JSON・全テストは無変更で通る。

```typescript
  // --- Phase 2 拡張フィールド（すべて任意・後方互換。96ut enriched 由来） ---

  /** 仮条件決定日（YYYY-MM-DD）。未取得は undefined。 */
  priceRangeDecisionDate?: string;
  /** 発行済株式数。未取得は undefined。 */
  issuedShares?: number;
  /** 想定ベースの吸収金額（億円）。absorptionAmount は公開価格ベース優先のため別枠で持つ。 */
  absorptionAmountAssumed?: number;
  /** 初値ベースの吸収金額（億円）。上場前は undefined。 */
  absorptionAmountInitial?: number | null;
  /** 幹事団の配分内訳。取得できなければ undefined。 */
  underwriterAllocations?: { name: string; shares: number | null; ratio: number | null }[];
  /** 会社概要。取得できなければ undefined。 */
  companyProfile?: {
    address: string | null;
    established: string | null;
    employeeCount: number | null;
    auditor: string | null;
  };
  /** 業績テーブル（複数期）。取得できなければ undefined。 */
  financialHistory?: {
    period: string;
    revenue: number | null;
    ordinaryProfit: number | null;
    netProfit: number | null;
    revenueChangePct: number | null;
  }[];
  eps?: number | null;
  bps?: number | null;
  dividendPerShare?: number | null;
  /** 大株主一覧。取得できなければ undefined。 */
  majorHolders?: {
    name: string;
    shares: number;
    ratio: number;
    lockupDays: number | null;
  }[];
  existingShareholderLockupShares?: number | null;
  existingShareholderLockupCoverage?: number | null;
  vcEstimatedHoldingRatio?: number | null;
  vcEstimatedLockupRatio?: number | null;
  stockOptionShares?: number | null;
  /** enriched データの出典（フィールド名 -> URL・取得日時）。UIで「出典」リンクを出すのに使う。 */
  enrichedSources?: Partial<Record<string, { url: string; fetchedAt: string }>>;
```

**注意**: 既存の `absorptionAmount`（公開価格ベース、OA込み、億円）は変更しない。`absorptionAmountAssumed`/`absorptionAmountInitial` は別フィールドとして追加し、スコア計算（`scoreAbsorption`）は引き続き既存の `absorptionAmount` のみを見る（変更しない）。

### 2.3 `src/types/push.ts`（新規）

```typescript
// Web Push 購読レコードの型。KVに `push:sub:<endpoint のハッシュ>` で保存する想定。

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** 登録時刻（ISO）。 */
  createdAt: string;
  /** 通知カテゴリの購読設定。 */
  categories: {
    bbStart: boolean;
    allotment: boolean;
    purchaseDeadline: boolean;
    listing: boolean;
    lockupExpiry: boolean;
  };
}

/** クライアント→サーバーへ送る購読登録リクエストのボディ。 */
export interface PushSubscribeRequest {
  subscription: PushSubscriptionRecord["keys"] extends never
    ? never
    : {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
  categories: PushSubscriptionRecord["categories"];
}
```

---

## 3. merge.ts の3層化（foundation/integration 担当のみが触る）

### 3.1 方針

- 優先順位: **base（手動）＞ enriched（96ut自動）＞ auto（価格等の自動更新）**
- `IpoEnriched` のフィールドは「base 側が既定値のまま（未入力）」の場合のみ enriched の値で埋める。base に手動で入力済みの値は enriched で上書きしない。
- 「base が既定値かどうか」の判定は `src/lib/completeness.ts` の考え方を流用し、フィールドごとに次のルールで判定する:
  - `bbPeriod`: `start === "" && end === ""` なら未入力
  - `allotmentDate`: `=== ""` なら未入力
  - `purchasePeriod`: 同上
  - `offeringPrice`: `=== null` なら未入力
  - `publicShares`/`saleShares`/`overAllotment`/`offeringRatio`/`issuedShares`: `=== 0` または `undefined` なら未入力
  - `underwriters`（既存配列）: `underwriterAllocations` が enriched にあり base の `underwriters.length <= 1` なら enriched の配分情報で `underwriters` 配列を拡張（主幹事は変えない）
  - それ以外の Phase2新規フィールド（`companyProfile`/`financialHistory`/`majorHolders` 等）: base 側にフィールド自体が無い（`undefined`）なら enriched の値を採用

### 3.2 新しい純関数シグネチャ

`src/lib/merge.ts` に追記:

```typescript
import type { IpoEnriched } from "@/types/enriched";

/** enriched の1フィールドを base の値の上に重ねるべきか判定するヘルパ群（フィールドごとに個別実装）。 */
function isFieldEmpty(kind: "dateRange" | "date" | "price" | "count" | "generic", value: unknown): boolean;

/** base に enriched を重ねる（base優先、未入力のみ埋める）。auto適用前に呼ぶ。 */
export function applyEnriched(base: Ipo, enriched: IpoEnriched | undefined): Ipo;

/** mergeIpos のシグネチャ変更（enriched 引数を追加。省略時は [] 扱いで既存動作と同一）。 */
export function mergeIpos(
  base: IpoBase[],
  auto: IpoAuto[],
  enriched?: IpoEnriched[],
): Ipo[];
```

- `mergeIpos` の内部処理順序: `base` → `applyEnriched(base[i], enrichedByCode.get(code))` → `mergeOne(結果, auto[i])`。
- `skeletonFromAuto`（新規発見銘柄）にも enriched を適用できるよう、スケルトン生成後に `applyEnriched` を通す。
- 既存の呼び出し元（`src/lib/repository.ts`）は `enriched` 引数を渡さなければ従来どおり動く（第3引数はオプショナル）ので、後方互換を壊さない。**ただし repository.ts 自体の更新（enriched の読み込み追加）は integration タスクが行う**（§7）。

---

## 4. 純関数のシグネチャと責務

### 4.1 統計 `src/lib/stats/initialReturnStats.ts`

```typescript
import type { Ipo } from "@/types/ipo";

/** 吸収金額帯のバケット定義（億円）。 */
export type AbsorptionBucket = "under10" | "10to30" | "30to100" | "100to500" | "over500";

export interface BucketStat {
  bucket: string;
  /** 対象件数（母数）。 */
  count: number;
  /** 初値騰落率の平均（%）。count===0 なら null。 */
  avgReturn: number | null;
  /** 公募割れ率（%）。count===0 なら null。 */
  breakEvenRate: number | null;
}

/** 吸収金額帯 × （市場 or 地合い、いずれか1軸）で分布を集計する。 */
export function bucketByAbsorption(
  ipos: Ipo[],
  splitBy?: "market" | "sentiment",
  sentimentOf?: (ipo: Ipo) => import("@/types/ipo").Sentiment | null,
): BucketStat[];

/** 主幹事別の公募割れ率（初値<公開価格の比率）。上場済かつ両価格が揃う銘柄のみ対象。母数10件未満は「参考情報（母数少）」を別フラグで返す。 */
export interface UnderwriterStat {
  underwriter: string;
  count: number;
  breakEvenRate: number | null;
  avgReturn: number | null;
  /** 母数が少なく参考程度であることを示すフラグ（count < 10）。 */
  lowSample: boolean;
}
export function statsByUnderwriter(ipos: Ipo[]): UnderwriterStat[];

/** オファリングレシオ帯別の統計。offeringRatio===0（未取得）は除外する。 */
export type OfferingRatioBucket = "under10" | "10to20" | "20to30" | "30to50" | "over50";
export function bucketByOfferingRatio(ipos: Ipo[]): BucketStat[];

/**
 * 特定銘柄について「類似IPOの初値実績」を返す。
 * 類似条件: 同一市場 かつ 吸収金額が対象銘柄の0.5〜2倍の範囲、上場済のみ。
 * 対象銘柄自身は除外。上限 limit 件（listingDate降順=新しい順）。
 */
export interface SimilarStatEntry {
  ipo: Ipo;
  returnRate: number | null;
}
export function findSimilarIpoStats(
  ipos: Ipo[],
  target: Ipo,
  limit?: number,
): SimilarStatEntry[];
```

**責務の境界**: この関数群は「初値騰落率＝(initialPrice - offeringPrice) / offeringPrice × 100」（既存 `src/lib/format.ts` の `initialReturnRate` をそのまま使う）を集計するだけで、スコアには一切影響しない（表示専用の実績統計）。母数が0件の場合は必ず `null` を返し、UIは「データ不足で集計できません」を出す。**母数を必ず表示する**（例: 「n=23」）。

### 4.2 BB優先順位 `src/lib/bb/priority.ts`

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";

export interface PriorityFactor {
  key: "allocationRatio" | "lotteryFairness" | "depositBurden" | "penaltyRisk";
  label: string;
  /** -2〜+2 の寄与点。 */
  points: number;
  reason: string;
}

export interface BrokerPriorityResult {
  broker: Broker;
  /** 合計点（優先順位の並び替えキー。降順が優先度高）。 */
  score: number;
  factors: PriorityFactor[];
  /** この証券会社が引受団に含まれるか。含まれない場合は score=最低・理由「引受団に含まれず申込不可」。 */
  inSyndicate: boolean;
}

/**
 * 1銘柄について、証券会社ごとの申込優先順位を算出する純関数。
 * 判定要素:
 *  - allocationRatio: 幹事配分比率（underwriterAllocations があればそれを使用、無ければ主幹事=+2/引受団=+1/対象外=-2の簡易判定）
 *  - lotteryFairness: 抽選方式（equal=+2 完全平等が最も有利、point=+1、proportional=0、stage=-1）
 *  - depositBurden: requiresDeposit=false なら+1（前受金不要は資金効率が良い）、trueなら0
 *  - penaltyRisk: penaltyOnCancel=true なら-1（辞退ペナルティがあると柔軟性が下がる）、falseなら0
 * 合計点降順でソートした配列を返す（呼び出し側はそのまま表示順に使える）。
 */
export function rankBrokerPriority(
  ipo: Ipo,
  brokers: Broker[],
): BrokerPriorityResult[];
```

### 4.3 資金拘束カレンダー `src/lib/bb/fundLock.ts`

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { BbState } from "@/types/userData";

export interface FundLockPeriod {
  ipo: Ipo;
  broker: Broker;
  /** 拘束開始日（購入申込期間の開始、無ければBB期間開始）。 */
  start: string;
  /** 拘束終了日（購入申込期間の終了、無ければ上場日）。 */
  end: string;
  /** 想定拘束金額（円）＝ estimatedLockAmount(ipo)（既存 src/lib/format.ts を再利用）。 */
  amount: number;
}

export interface FundLockDay {
  /** YYYY-MM-DD */
  date: string;
  /** その日に重なっている拘束の合計金額（円）。 */
  totalAmount: number;
  periods: FundLockPeriod[];
}

/**
 * bbState の中で status が applied/won の銘柄×証券会社について、
 * 資金拘束期間を洗い出す（requiresDeposit=false の証券会社は拘束なし=0円、期間は返すがamount=0）。
 */
export function collectFundLockPeriods(
  ipos: Ipo[],
  brokers: Broker[],
  bbState: BbState,
): FundLockPeriod[];

/**
 * 拘束期間の重なりを日付ごとに集計する（今日から先 windowDays 日分、既定30日）。
 * todayIso は呼び出し側から注入（Date.now を直接呼ばない）。
 */
export function buildFundLockCalendar(
  periods: FundLockPeriod[],
  todayIso: string,
  windowDays?: number,
): FundLockDay[];
```

### 4.4 イベント `src/lib/events/index.ts`

```typescript
import type { Ipo } from "@/types/ipo";

export type IpoEventKind =
  | "bbStart"
  | "bbEnd"
  | "allotment"
  | "purchaseStart"
  | "purchaseEnd"
  | "listing"
  | "lockupExpiry"
  | "priceReleaseLine" // 1.5倍条項の判定対象になる日（=上場日と同義。情報として明示）
  | "firstEarnings"
  | "largeHoldingReport";

export interface IpoEvent {
  ipo: Ipo;
  kind: IpoEventKind;
  /** イベント日（YYYY-MM-DD）。 */
  date: string;
  /** 表示用の一言説明。 */
  detail: string;
}

export const EVENT_KIND_LABELS: Record<IpoEventKind, string>;

/**
 * 全銘柄からイベントを洗い出す。ロックアップ解除日は
 * listingDate + lockup.days（既存 src/lib/checklist/items.ts の
 * checkLockupExpiry と同じ addDaysIso ロジックを共有ヘルパ化して再利用する。
 * 1.5倍条項（hasPriceRelease）がある銘柄は listing 当日に「1.5倍解除条件あり」の
 * priceReleaseLine イベントも追加する。
 * todayIso は呼び出し側から注入。過去日も含めて全件返す（フィルタはUI側）。
 */
export function buildAllEvents(ipos: Ipo[], todayIso: string): IpoEvent[];

/** 指定期間内（today ± daysなし、today〜today+days）のイベントのみに絞る。 */
export function filterUpcomingEvents(
  events: IpoEvent[],
  todayIso: string,
  days: number,
): IpoEvent[];
```

**共有ヘルパの抽出**: `src/lib/checklist/items.ts` 内の `addDaysIso`/`daysBetween` は現状ファイルスコープの非公開関数の可能性が高い。**detail タスクの担当外**なので、このヘルパを `src/lib/date.ts`（新規、**foundationタスクが作成**）に切り出し、`checklist/items.ts` と `events/index.ts` の両方から import する設計にする（重複実装を避ける）。`src/lib/checklist/items.ts` の変更は最小限（import元の切り替えのみ）とし、**foundation タスクが行う**（checklist は共有ファイルの「読み取り専用」指定だが、この1点=date.ts切り出しに伴うimport文修正のみ例外的にfoundationが担当してよい。他のロジック変更は禁止）。

```typescript
// src/lib/date.ts（新規、foundation担当）
/** YYYY-MM-DD に日数を加算した YYYY-MM-DD を返す。 */
export function addDaysIso(dateIso: string, days: number): string;
/** 2つの YYYY-MM-DD の差（b - a、日数）。パース不能なら NaN ではなく 0 は使わず、呼び出し側でハンドリングできるよう Number.NaN を返す。 */
export function daysBetween(a: string, b: string): number;
```

---

## 5. UI設計

### 5.1 銘柄詳細ページ（`src/components/IpoDetailClient.tsx` 拡張、detailタスク）

既存セクション順を維持しつつ、以下を追加する。**セクション順序（上から下）**:

1. ヘッダー（既存）
2. 価格（既存 PriceCard。§5.6 でチャート切替を追加）
3. スコア（既存）
4. スコア内訳（既存）
5. 基本情報（既存 BasicInfoList。§5.2 で「会社概要」「幹事配分」「大株主」を追加）
6. **業績（新規セクション `FinancialHistory`）** ← §5.3
7. 日程（既存 Timeline。§5.4 で仮条件決定日を追加）
8. BB申込状況（既存）
9. 投資判断チェックリスト（既存）
10. **類似IPOの実績（新規 `SimilarIpoStats`）** ← §5.5（既存の `SimilarIpos`＝手動 similarIpoCodes 由来のリストとは別物。両方存在する場合は類似IPOの実績を先に表示し、旧SimilarIposは残す）
11. メモ（既存）

出典表示の共通規則: enriched由来の値を表示するListRow等には、値の右に小さい `出典` リンク（`enrichedSources[field].url`、新規タブ、`text-[10px] text-muted underline`）を添える。出典が無い（base手動入力 or auto由来）フィールドには出典リンクを出さない。

### 5.2 基本情報の拡張（`src/components/detail/BasicInfoList.tsx`、detailタスク）

既存の ListRow 積み上げに以下を追加（値が undefined/null の項目は「未取得」）:

```
会社概要（Cardで独立、ListRow4行）:
  所在地 / 設立 / 従業員数 / 監査法人
幹事配分（Cardで独立、幹事ごとに1行）:
  {証券会社名} | 割当 {shares.toLocaleString()}株（{ratio}%） ※ shares/ratio が両方nullなら「割当 未取得」
大株主（Cardで独立、上位5件まで、超過分は「他N名」表記）:
  {氏名} | {shares.toLocaleString()}株（{ratio}%）| ロック{lockupDays}日 ※lockupDaysがnullなら「ロック共通」
既存株主ロックアップ:
  対象株数 {existingShareholderLockupShares}株 / カバー率 {existingShareholderLockupCoverage}%
VC推定保有:
  {vcEstimatedHoldingRatio}%（うちロックアップ対象 {vcEstimatedLockupRatio}%）
ストックオプション:
  {stockOptionShares}株
```

すべて `undefined` のセクション（例: `majorHolders` が undefined）は**セクションごと非表示**にする（空のCardを出さない）。

### 5.3 業績セクション（`src/components/detail/FinancialHistory.tsx`、新規、detailタスク）

```
見出し: 業績
表: 決算期 | 売上高 | 経常利益 | 当期利益 | 売上高変化率
（financialHistory が undefined または空配列なら Section ごと非表示）
各セルは null なら「—」。金額は百万円表記（formatMillion ヘルパをformat.tsに追加、foundation/integrationが対応するか、detail担当がformat.tsを触らずローカルヘルパとして実装してよい＝format.tsは共有読み取り専用のため）
```

### 5.4 日程タイムラインの拡張（`src/components/detail/Timeline.tsx`、detailタスク）

既存4ステップの先頭に「仮条件決定日」を追加（5ステップに）。`priceRangeDecisionDate` が undefined/空文字なら「未取得」。

### 5.5 類似IPOの実績（`src/components/detail/SimilarIpoStats.tsx`、新規、detailタスク）

```
見出し: 類似IPOの実績
補足文: "同市場・吸収金額が近い（0.5〜2倍）直近上場銘柄の初値実績です（機械的集計・参考情報）"
本体: findSimilarIpoStats() の結果をカード横並び（最大5件）。各カードは 銘柄名・上場日・初値騰落率（PriceChange流用）。
0件時: EmptyState「類似条件に一致する上場済銘柄がありません」
```

このセクションは `getAllIpos()` の全件が必要なため、`page.tsx`（detailタスクが変更する `src/app/ipo/[code]/page.tsx`）で `findSimilarIpoStats(allIpos, ipo)` を計算しClientへpropsで渡す（既存の `similarIpos` 計算パターンを踏襲）。

### 5.6 セカンダリーチャート（`src/components/detail/CandleChart.tsx`、新規、detailタスク）

```
配置: PriceCard 内、既存 Sparkline の代わりではなく追加のトグル切替（"折れ線" / "ローソク足"のSegmented、既定は折れ線=現状維持）
ローソク足モード選択時:
  /api/quote/[code] のレスポンスを180日分に拡張して取得（既存のcloses配列にopen/high/low拡張が必要 → §6.4 API変更）
  25日移動平均線を細線で重ねる（既存 src/lib/market/sentiment.ts の movingAverage を再利用。ただし movingAverage は市場全体の判定用でclosesのみ受け取る設計なので、そのまま呼べる）
  出来高を下段に棒グラフ（同じSVG内、高さ20%を割り当て）
  公開価格ライン・初値ラインを破線で表示（value=ipo.offeringPrice, ipo.initialPrice）
  データ不足（closes.length<2）時は「チャート表示に十分なデータがありません」
```

### 5.7 BB戦略ボード（`src/components/BbManagerClient.tsx` 拡張、bbタスク）

既存の `BbSummary` の直後、`targetIpos` の一覧の前に2セクション追加:

```
Section「申込先の優先順位」（銘柄選択Segmented + BbPriorityBoard）:
  対象銘柄をセグメントで1つ選ぶ（既定は上場日が最も近い銘柄）
  rankBrokerPriority() の結果を降順リストで表示。各行: 証券会社名・合計点をChip（tone: 点数>=2ならup、<=-2ならdown、それ以外neutral）・factors を折りたたみ詳細で表示
  inSyndicate=false の証券会社は行全体を text-muted にし「引受団に含まれず対象外」を明記

Section「資金拘束カレンダー」（BbFundCalendar）:
  buildFundLockCalendar() の結果を日付順リスト表示（今後30日、拘束金額>0の日のみ）
  各日: 日付・合計拘束金額（太字）・内訳（銘柄名×証券会社名のChip列）
  0件時: EmptyState「今後30日間の資金拘束予定はありません」
```

### 5.8 統計ページ（`src/app/stats/page.tsx` + `src/components/stats/StatsClient.tsx`、新規タスク=stats）

ボトムタブは増やさない。導線は `/screener` 画面上部に「実績統計を見る →」リンク（screenerタスクが1行追加）と `/ipo/[code]` の類似IPO実績セクション末尾に「全体の統計を見る →」リンク（detailタスクが追加）。

```
見出し: 実績統計
補足: "過去の初値実績を機械的に集計した参考情報です。将来の成績を保証するものではありません。"

Section「吸収金額帯別」:
  bucketByAbsorption(ipos) をテーブル表示（帯 / 母数n / 平均初値騰落率 / 公募割れ率）
  母数0の帯は行ごと「データなし」表記で残す（帯の存在は見せる）

Section「主幹事別 公募割れ率」:
  statsByUnderwriter(ipos) を公募割れ率昇順（良い順）でテーブル表示
  lowSample=true の行に「※母数少（n<10）」の注記チップ

Section「オファリングレシオ帯別」:
  bucketByOfferingRatio(ipos) をテーブル表示（同上）

全セクション末尾: 「集計対象: 上場済かつ公開価格・初値が取得できている銘柄のみ（全{listed件数}銘柄中{対象件数}銘柄）」の母数注記を必ず表示
```

### 5.9 イベントカレンダー（`src/app/events/page.tsx` + `src/components/events/EventsClient.tsx`、新規タスク=events）

導線: `/ipos` 画面上部に「イベントカレンダーを見る →」リンク（iposタスクが1行追加）。

```
見出し: イベントカレンダー
セグメント: 「今後30日」/「今後90日」/「すべて」
一覧: buildAllEvents() → filterUpcomingEvents() の結果を日付昇順リスト。
  各行: 日付・EVENT_KIND_LABELS[kind]のChip・銘柄名（タップで詳細へ）・detail文言
  0件時: EmptyState「該当期間にイベントがありません」
```

### 5.10 プッシュ通知トグル（`src/components/settings/PushSubscribeToggle.tsx`、新規、settingsタスク）

`src/components/SettingsClient.tsx`（settings担当が書き換え中のもの）内、既存の設定項目群の末尾に追加:

```
見出し: 通知
本文（未購読時）: 「BB開始・抽選日・購入期限・上場日・ロックアップ解除の通知を受け取れます」+ [通知を有効にする]ボタン
  iOS判定: navigator.standalone または matchMedia('(display-mode: standalone)') が false かつ iOS UA の場合、
  ボタンの代わりに「iOSでは共有→ホーム画面に追加した後のみ利用できます」を表示（ボタン非活性）
本文（購読済み時）: カテゴリ別トグル5つ（BB開始/抽選/購入期限/上場/ロック解除）+ [通知を停止]ボタン
```

---

## 6. データ取得の実装詳細

### 6.1 96ut スクレイパー本体 `scripts/updater/kabu96ut.ts`

```typescript
import * as cheerio from "cheerio";
import type { IpoEnriched, SourceRef } from "../../src/types/enriched";

export const KABU96UT_BASE = "https://kabu.96ut.com/article/ipo/";

/** 記事番号（例 "2026035"）から記事URLを組み立てる。 */
export function articleUrl(articleNo: string): string;

/**
 * 1記事のHTMLを取得する。404はnullを返す（呼び出し側でスキップ扱い）。
 * それ以外のHTTPエラー・タイムアウトは例外を投げる。
 * レート制御: 呼び出し側（discover）が1req/秒以上の間隔を空ける責務を持つ
 * （この関数自体は1回のfetchのみ、待機は含まない）。
 */
export async function fetchArticleHtml(articleNo: string): Promise<string | null>;

/**
 * 1記事のHTMLをパースして IpoEnriched を返す。
 * パース方針（堅牢性優先）:
 *  - テーブルの行は th/td のラベルテキストで判定する（列位置に依存しない）
 *  - ラベルは正規化して比較する（全角/半角スペース除去、括弧の表記揺れを吸収する
 *    normalizeLabel() ヘルパを内部に持つ）
 *  - 既知ラベルの候補は配列で複数持つ（例: BB期間のラベルは
 *    ["ＢＢ期間", "BB期間", "ブックビルディング期間"] のいずれかにマッチ）
 *  - 見つからないラベルは該当フィールドを省略（=undefined）。例外を投げない
 *  - 数値パースに失敗した場合もそのフィールドのみ省略し、他フィールドの抽出は継続する
 *  - code は呼び出し側（articleNo→banner等）から渡すのではなく、ページ内の
 *    銘柄コード表記（タイトル内の "(648A)" 等）から抽出する。抽出できなければ
 *    この記事は「パース失敗」として null を返す（呼び出し側は該当記事をスキップ）
 */
export function parseKabu96utHtml(
  html: string,
  articleUrl: string,
  fetchedAt: string,
): IpoEnriched | null;

/**
 * 「構造変更検知」: 既知ラベル候補のうち1つも見つからないテーブルが規定数
 * （目安: 主要ラベル「ＢＢ期間」「公募価格」「主幹事証券」の3つすべて）を超えて
 * 欠落した場合、ページ構造が変わった可能性が高いとみなし console.warn で
 * `[kabu96ut] 構造変更の疑い: ${articleUrl} で主要ラベルが検出できませんでした`
 * を出力する（例外は投げず、部分的に取れたフィールドはそのまま返す）。
 * この関数は parseKabu96utHtml の内部で呼ぶ非公開ヘルパでよいが、
 * テストのため export しておく。
 */
export function detectStructureChange(labelsFound: Set<string>): boolean;
```

**テスト `scripts/updater/kabu96ut.test.ts`**:
- フィクスチャ1（正常系・実ページ保存）: 全主要フィールドが期待通り抽出できることを検証
- フィクスチャ2（ラベル表記揺れ版・手動で一部ラベルを変えたHTML）: 揺れを吸収して抽出できることを検証
- フィクスチャ3（構造大幅変更版）: `detectStructureChange` が true を返すことを検証
- 数値パース境界: "1,200円～1,400円"→`{low:1200,high:1400}`、"未定"/"未発表"→undefined、"-"→undefined

**フィクスチャHTML保存の実装タスク**: 実装エージェントが実行時に `fetchArticleHtml` で1〜2件（例: 2026035）を実際に取得し `scripts/updater/__fixtures__/kabu96ut/normal-2026035.html` として保存する。取得できない場合（ネットワーク制限等）は既存の `context.md` に記載された構造の要約から手書きの最小HTMLフィクスチャを作成してよい（構造検証が目的であり実データの完全再現は必須ではない）。表記揺れ版・構造変更版フィクスチャは正常系を手動で改変して作る。

### 6.2 記事発見 `scripts/updater/kabu96ut-discover.ts`

```typescript
/**
 * 対象年の記事番号候補を発見する。
 * 方針: サイトマップ（https://kabu.96ut.com/post-sitemap{N}.xml）を優先し、
 * article/ipo/ を含むURLから記事番号を抽出する。サイトマップが取得できない場合は
 * カテゴリ一覧ページ（https://kabu.96ut.com/article/category/ipo/）から
 * リンクを収集する（フォールバック）。
 * 戻り値は記事番号の配列（例: ["2026001", "2026002", ...]）、重複排除・昇順。
 */
export async function discoverArticleNumbers(year: number): Promise<string[]>;
```

### 6.3 main.ts への統合（integration/updaterタスク）

`scripts/updater/main.ts` に以下のステップを既存の「1) JPX」と「2) status導出」の間、または既存フロー末尾に追加（既存フローを壊さない位置で良い。候補は既存の6)の後、7)サマリの前）:

```
6.5) enriched 更新（96ut）
  - discoverArticleNumbers(現在年) と discoverArticleNumbers(前年) を実行（年跨ぎ対応）
  - 既存 ipos.enriched.json を読み込み、記事番号→codeの対応は前回実行時の記録
    （enriched配列の code と articleUrl）から再利用し、未知の記事番号のみ新規取得
  - 対象を絞る: base/auto の code のうち status が upcoming/bb_open/priced の銘柄
    （上場済銘柄は enriched を再取得しない=無駄なリクエストを避ける。1度取得できた
    上場済銘柄のenrichedレコードはそのまま保持する）
  - 1req/秒以上の間隔でfetchArticleHtml→parseKabu96utHtml
  - 404・パース失敗はスキップしてログに残す（件数をサマリに出力）
  - 取得成功分で ipos.enriched.json を更新（writeJsonIfChanged）
```

型は `IpoAuto` と同様に配列で `public/data/ipos.enriched.json` に保存する。

### 6.4 quote API の拡張（`src/app/api/quote/[code]/route.ts`、foundation/integration）

ローソク足対応のため、既存レスポンスに `open`/`high`/`low` を追加する（**破壊的変更ではなく追加のみ**、既存の `close`/`volume` は変更しない）:

```typescript
interface QuoteClose {
  date: string;
  close: number;
  volume: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
}
```

クエリパラメータ `?range=180` を受け付け、指定があれば `LOOKBACK_DAYS` の代わりに使う（未指定時は既存の120日のまま、既存の呼び出し元=PriceCardは変更不要）。`src/lib/quote.ts` の `QuotePoint`/`fetchQuote` も同様に `open?`/`high?`/`low?` を追加し、`fetchQuote(code, signal, range?)` のオプション引数を増やす。

---

## 7. スコア再校正のバックテスト手順（`scratch/backtest/recalibrate.py`、新規）

### 7.1 目的

`scratch/backtest/report.md` の結論（BB参加判断＝初値売りが主戦場、効く要因は吸収金額・OR・主幹事別・仮条件上限決定・ロックアップ・地合い）を踏まえ、`src/lib/scoring/weights.ts` の `supplyDemand` プリセットの重みを実証データで再校正する。**実装前に必ずこのスクリプトを実行し、結果を `report-phase2.md` に記録してから重みを変更する**（本人裁定）。

### 7.2 データ

既存 `scratch/backtest/data/`（`ipo_list.csv` 169件、`fundamentals.csv`、`prices/*.csv`）をそのまま使う。目的変数は「初値騰落率」= `(first_price - offer_price) / offer_price * 100`（`ipo_list.csv` の列から直接計算可能、価格データの追加取得は不要）。

### 7.3 手順（実装エージェントが実行するコマンド）

```bash
cd /Users/kazukiyoshida/ipo-analyzer/scratch/backtest
./venv/bin/python recalibrate.py
```

`recalibrate.py` の内部処理:

1. `data/ipo_list.csv` と `data/fundamentals.csv` を `code` でJOINし、`offer_price`/`first_price` が両方揃う行のみ残す（欠損は除外し、除外件数をログ出力）。
2. 目的変数 `initial_return = (first_price - offer_price) / offer_price * 100` を計算。
3. 既存の `src/lib/scoring/items.ts` の各項目関数（`scoreAbsorption`/`scoreMarket`/`scoreVcLockup`/`scoreOfferingStructure`/`scoreUnderwriter`/`scoreSchedule`/`scoreDownside`）と**同じ閾値ロジックをPythonで再実装**（TypeScriptを直接呼べないため）し、各銘柄について各項目の `points`（-2〜+2）を計算する。
   - 実装時の注意: `scoreUnderwriter`/`scoreSentiment` はユーザー設定依存のためバックテストでは対象外（既定 0 として固定するか、この2項目は除外して残り7項目のみで検証する）。
4. 各項目の `points` と `initial_return` の**相関係数（Pearson・Spearman両方）**を算出し、`report-phase2.md` 用の表を出力する。
5. 相関が有意に見える項目（|相関|が他項目より明確に大きい、目安 |r|>0.15 かつ n>=50）について、**重みを現状比で相対的に強める方向**の新しい `supplyDemand` プリセット候補を1つ提案する（絶対値の最適化ではなく「効いている項目の重みを1段階上げる」程度の保守的な調整に留める。過学習を避けるため）。
6. 提案した新プリセットで**簡易バックテスト**: 全銘柄の総合スコア（新プリセット重み適用）を計算し、スコア上位30%群 vs 下位30%群の平均初値騰落率を比較する（現行 `balanced` プリセットとの比較も併記）。
7. 結果一式（相関表・新プリセット案・上位/下位群比較・サンプルサイズ）を `scratch/backtest/report-phase2.md` に書き出す。

### 7.4 受け入れ基準（このステップの完了条件）

- `report-phase2.md` に相関表・新プリセット案・上位/下位群比較が記載されている
- 新プリセット案が現行 `balanced` を上回る（上位30%群の平均初値騰落率が高い）場合のみ `src/lib/scoring/weights.ts` の値を変更する。上回らない場合は **現状維持し、その旨を report-phase2.md に明記する**（「効果が実証できなかったため重みは変更しない」という結論も正しい結果として扱う。これがデータ品質・実証優先レンズの核）。
- `weights.ts` を変更する場合、既存の `WEIGHT_PRESETS.supplyDemand` の値のみを差し替え、`balanced`/`fundamental` プリセットとキー構造は変更しない（`src/lib/scoring/weights.test.ts` 等の既存テストが通ることを確認）。

---

## 8. テスト観点

### 8.1 単体テスト（vitest、各タスクが自分の担当ファイルに対して作成）

| ファイル | 観点 |
|---|---|
| `scripts/updater/kabu96ut.test.ts` | フィクスチャ3種（正常/表記揺れ/構造変更）でのパース結果、数値パース境界（レンジ・未定・ハイフン）、コード抽出失敗時にnullを返す |
| `src/lib/merge.test.ts`（既存ファイルに追記、integration担当） | `applyEnriched`: base既定値のみ埋まる／base手動入力済みは上書きされない／enriched未定義時は従来のmergeOneと同結果 |
| `src/lib/stats/initialReturnStats.test.ts` | 各バケット境界値（9/10/29/30億円等）、母数0件でnull、lowSampleフラグの境界（n=9/10） |
| `src/lib/bb/priority.test.ts` | 抽選方式4種の点数、inSyndicate=falseのケース、requiresDeposit/penaltyOnCancelの組み合わせ |
| `src/lib/bb/fundLock.test.ts` | 期間重複2件の合算、windowDays境界、購入期間が空でBB期間にフォールバックするケース |
| `src/lib/events/index.test.ts` | ロックアップ解除日の計算（addDaysIso境界）、1.5倍条項ありなし、firstEarningsDate/largeHoldingReportがnullの場合にイベント生成しない |
| `src/lib/date.test.ts`（foundation） | addDaysIso/daysBetweenの境界（月またぎ・年またぎ・不正日付） |
| `src/lib/completeness.test.ts`（既存、変更不要のはずだが影響確認） | Phase2フィールド追加がlevel判定に影響しないことを確認するテストケースを1件追加してよい |

### 8.2 コンポーネントテスト（既存にコンポーネントテストが無ければ新規追加は必須ではないが、機械検証の375px/1280pxチェックは全ルートに必須）

- `/ipo/<enriched取得済コード>` と `/ipo/<enriched未取得コード>` の両方で崩れがないこと
- `/stats` `/events` を375px/1280pxで確認（新規ルートのため`hp-production.md`の機械検証対象に追加）
- プッシュ通知トグル: iOS UA + standalone=false のケースでボタンが非活性表示になること（javascript_toolでnavigator.standaloneをモックしてスクリーンショット確認）

### 8.3 手動確認観点

- 96ut updater実行後、`ipos.enriched.json` の全レコードに `sources` が最低1件あること（出典なしのenrichedレコードが無いこと）
- スコア再校正: `report-phase2.md` の数値が `weights.ts` の実際の変更内容と整合していること

---

## 9. 受け入れ基準（Phase 2 全体の納品ゲート）

`scratch/mobile-design.md` §8 に加え、以下を満たすこと:

1. `npx tsc --noEmit` 0 / `npm run lint` 0 / `npm test` 全通過 / `npm run build` 成功
2. 375px・1280pxで新規ルート（`/stats` `/events`）含む全ルートで横はみ出し0
3. 禁止語（買い／買う／売り推奨／推奨／おすすめ／お宝／必勝／爆益／テンバガー／勝てる／儲か）grep が `src/` 配下でゼロ。96utから取り込んだ「初値予想」「BB参加姿勢」等の主観評価文言が `IpoEnriched`/`Ipo` のどのフィールドにも入っていないこと（数値・日付・株数のみ取り込む）
4. localStorage キーの変更なし（新規キーを追加する場合は `ipo-analyzer:push:v1` のように既存規則に従う。Phase2で新規キーが必要になるのは push購読状態のクライアント側キャッシュ程度で、購読の正本はKV/サーバー側）
5. 既存ファイルの削除なし
6. enriched データを持つ全レコードに出典URL・取得日時が入っている
7. `report-phase2.md` が存在し、スコア重み変更の有無とその根拠が明記されている
8. `scripts/updater/kabu96ut.test.ts` がフィクスチャHTML3種で通過する
9. Cloudflareの有料機能（Durable Objects課金枠超過、R2、Queues等）を使わない。KV（Workers無料枠内）とCron Triggers（無料枠内、1日数回程度）のみ許容
10. 依存追加はチャートライブラリなし（CandleChartは自前SVG）、Web Pushライブラリは追加する場合もWorkers/Edgeランタイム互換品のみ（Node専用の`web-push`パッケージはCloudflare Workersで動作しない可能性が高いため、VAPID署名はWeb Crypto API直書き、またはWorkers互換と明記されたライブラリに限定し、**実装タスクの着手前に対象ライブラリがCloudflare Workersで動作するか確認する**。動作確認できなければ通知送信部分は「設計のみ・実装は次フェーズ」として見送ってよい＝本人裁定の「確認で手を止めてよい4項目」には該当しないため実装エージェントの判断で保留してよい）

---

## 10. 実装タスク分割（並列実装用）

### 共有ファイル規律

以下は **foundation** または **integration** の単一タスクのみが触る。他タスクは読み取り専用として参照するのみ、変更が必要な場合は成果物に `sharedChangeRequests` として要望を書き、自分では編集しない:

`src/types/*`、`src/lib/merge.ts`、`src/lib/repository.ts`、`package.json`、`src/app/ipo/[code]/page.tsx`、`src/components/IpoDetailClient.tsx`、`src/components/HomeClient.tsx`（存在するなら）、`src/components/BbManagerClient.tsx`、`src/components/settings/SettingsClient.tsx`（存在パスを確認: 実際は `src/components/SettingsClient.tsx`）、`src/components/nav/BottomTabBar.tsx`、`src/lib/date.ts`（新設）、`scripts/updater/main.ts`、`wrangler.jsonc`。

### タスク一覧

#### タスク A: foundation（型・共有ヘルパ・merge）

- **担当ファイル**: `src/types/enriched.ts`（新規）、`src/types/ipo.ts`（追記のみ）、`src/types/push.ts`（新規）、`src/lib/merge.ts`（`applyEnriched`/`mergeIpos`拡張）、`src/lib/date.ts`（新規）、`src/lib/checklist/items.ts`（`addDaysIso`/`daysBetween`のimport元切り替えのみ、ロジック変更禁止）
- **公開インターフェース**: §2.1〜2.3の型全部、§3の `applyEnriched`/`mergeIpos`、§4.4末尾の `addDaysIso`/`daysBetween`
- **依存順**: 最初に着手（他の全タスクがこれらの型に依存する）。着手前提条件なし

#### タスク B: data（96utスクレイパー・enrichedデータ生成）

- **担当ファイル**: `scripts/updater/kabu96ut.ts`、`scripts/updater/kabu96ut.test.ts`、`scripts/updater/__fixtures__/kabu96ut/*.html`、`scripts/updater/kabu96ut-discover.ts`、`public/data/ipos.enriched.json`（初回生成物）
- **公開インターフェース**: `parseKabu96utHtml`、`fetchArticleHtml`、`articleUrl`、`discoverArticleNumbers`、`detectStructureChange`（§6.1〜6.2のシグネチャ）
- **依存順**: タスクA（`IpoEnriched`型）完了後に着手

#### タスク C: integration（main.ts統合・repository・API拡張）

- **担当ファイル**: `scripts/updater/main.ts`（enriched更新ステップ追加）、`src/lib/repository.ts`（enriched読込・`mergeIpos`呼び出し更新）、`src/app/api/quote/[code]/route.ts`（open/high/low・range対応）、`src/lib/quote.ts`（型・fetchQuote拡張）、`wrangler.jsonc`（KV/Cron追加。**本番反映相当の変更を含むため、実際のCloudflareリソース作成・デプロイは本人確認必須。設定ファイルへの記述までは可）
- **公開インターフェース**: `QuoteResponse`/`QuotePoint`拡張後の型、`loadIpoData`の戻り値（enriched込み）
- **依存順**: タスクA・タスクB完了後に着手（Bのenriched.jsonのサンプルが無くても型だけあれば着手可能なため、Bと並行着手も可。ただし実データでの動作確認はB完了後）

#### タスク D: stats（統計・類似IPO実績）

- **担当ファイル**: `src/lib/stats/initialReturnStats.ts`、`src/lib/stats/initialReturnStats.test.ts`、`src/app/stats/page.tsx`、`src/components/stats/StatsClient.tsx`
- **公開インターフェース**: §4.1の全関数（`bucketByAbsorption`/`statsByUnderwriter`/`bucketByOfferingRatio`/`findSimilarIpoStats`）
- **依存順**: タスクAのみに依存（`Ipo`型は既存のまま使用、enriched不要）。タスクB/Cと並行着手可

#### タスク E: detail（詳細ページ拡張）

- **担当ファイル**: `src/components/detail/BasicInfoList.tsx`、`src/components/detail/FinancialHistory.tsx`（新規）、`src/components/detail/Timeline.tsx`、`src/components/detail/SimilarIpoStats.tsx`（新規）、`src/components/detail/CandleChart.tsx`（新規）、`src/components/detail/PriceCard.tsx`
- **公開インターフェース**: なし（末端UI）。`findSimilarIpoStats`（タスクDへ依存）を使うが、`page.tsx`（integration担当）経由でpropsとして受け取る想定のため、`IpoDetailClient.tsx`自体の変更が必要になる → **`IpoDetailClient.tsx`はintegrationタスクが担当**し、detailタスクは新規セクションコンポーネントを作った上でintegrationに「このpropsで呼んでほしい」という利用例をコメントで残す
- **依存順**: タスクA・D完了後。CandleChartはタスクC（API拡張）完了後

#### タスク F: bb（BB戦略ボード）

- **担当ファイル**: `src/lib/bb/priority.ts`、`src/lib/bb/priority.test.ts`、`src/lib/bb/fundLock.ts`、`src/lib/bb/fundLock.test.ts`、`src/components/bb/BbPriorityBoard.tsx`（新規）、`src/components/bb/BbFundCalendar.tsx`（新規）
- **公開インターフェース**: §4.2〜4.3の全関数
- **依存順**: タスクAのみ（`BbManagerClient.tsx`への組み込みはintegrationが行う）

#### タスク G: events（イベントカレンダー）

- **担当ファイル**: `src/lib/events/index.ts`、`src/lib/events/index.test.ts`、`src/app/events/page.tsx`、`src/components/events/EventsClient.tsx`
- **公開インターフェース**: §4.4の全関数
- **依存順**: タスクA（`addDaysIso`/`daysBetween`）完了後

#### タスク H: push（プッシュ通知）

- **担当ファイル**: `src/app/api/push/subscribe/route.ts`、`src/app/api/push/unsubscribe/route.ts`、`src/lib/push/vapid.ts`、`src/components/settings/PushSubscribeToggle.tsx`、`public/sw.js`（push イベント部分のみ追記。他はfoundationが触るPWA基盤なので競合注意）、`scripts/push/send-daily.ts`
- **公開インターフェース**: `PushSubscriptionRecord`型（タスクA）を使用。route.tsのエンドポイント仕様（POST body形状）
- **依存順**: タスクA完了後。KV/Cron設定はタスクC（integration）と調整が必要なため、`wrangler.jsonc`の変更はintegrationに依頼する（sharedChangeRequestsに明記）。**Cloudflareの有料機能を使わないこと・Workers互換ライブラリの確認（§9-10）を最優先で行い、実現不可と判断したら実装を設計のみに留めてよい**

#### タスク I: integration（最終結線・ボトムタブ導線・UI組み込み）

上記A〜Hの成果物を結線する仕上げタスク。**A〜Hすべて完了後**に着手。

- **担当ファイル**: `src/components/IpoDetailClient.tsx`、`src/app/ipo/[code]/page.tsx`、`src/components/BbManagerClient.tsx`、`src/app/bb/page.tsx`（必要なら）、`src/components/screener/*`（統計ページへの導線リンク1行）、`src/app/screener/page.tsx`または`ScreenerClient`、`src/components/ipos/*`（イベントカレンダーへの導線リンク1行）、`src/components/SettingsClient.tsx`（PushSubscribeToggle組み込み）
- **公開インターフェース**: なし（最終結線）
- **依存順**: 全タスク完了後の最後の1タスク

### 実装順序案

```
A（foundation） → B・D・F（並行） → C（integration中間） → E・G・H（並行、Cに依存する部分あり） → I（integration最終結線）
```

---

## 11. 設計メモ（Phase 2 の 8〜10、将来案。本人判断待ち）

**8. クラウド同期（D1）**: 現在の全データはユーザーのブラウザ localStorage に閉じている（ウォッチリスト・BB申込状況・メモ）。複数端末で同期したい場合は Cloudflare D1（無料枠あり）にユーザー識別（認証方式は要検討、パスキー等の軽量な方式が個人ツールには適する）と紐づけて保存する設計が考えられる。ただし認証の実装コストとプライバシー設計（他人に見られたくない申込状況をどう守るか）が論点で、今回は着手しない。

**9. ネイティブ化**: `scratch/mobile-design.md` §0 の通り Capacitor 8 の前提整備は完了済み（`capacitor.config.ts` 等）。実際に `npx cap add ios/android` してストア申請まで進めるかは、PWA運用でどこまで不便を感じるか（プッシュ通知のiOS制約、ホーム画面アイコンの発見性等）を見てから判断するのが良い。ネイティブ化するとApple Developer Program登録費用（年額）が発生する点も判断材料。

**10. M1夜間ジョブ**: `scripts/updater/main.ts`（JPX・価格・EDINET・96ut）を毎日決まった時刻にM1予備機のcronで自動実行し、結果をリポジトリにコミット→デプロイまで自動化する案。現状は手動 `npm run update:data` 実行。夜間ジョブ化する場合は `~/.claude/rules/m1-server.md` の運用規律（`m1-ops` Skill）に従い、96ut取得のレート制御（1req/秒以上の間隔）を守りつつ全銘柄enriched更新には数十分かかりうる点を考慮したスケジュール設計が必要。
