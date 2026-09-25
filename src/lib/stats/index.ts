import type { IpoStatus, Market } from "@/types/ipo";

// 上場済み銘柄の初値実績を機械的に集計する純関数群。
// 母数0は null / sampleCount:0 を返し、例外は投げない。
// 吸収金額・ORが 0 以下（または null）の銘柄は「未取得」とみなし、帯別集計の対象から外す。
// 入力は Ipo と HistoricalIpo（2015〜2023）の両方を受ける（どちらも OutcomeSource を構造的に満たす）。

/**
 * 集計に使う最小の共通形。Ipo・HistoricalIpo はそのまま渡せる。
 * status 未指定（履歴データ）は上場済みとして扱う。値が取れない項目は null。
 */
export interface OutcomeSource {
  code: string;
  name: string;
  market: Market | null;
  listingDate: string;
  offeringPrice: number | null;
  initialPrice: number | null;
  absorptionAmount: number | null;
  offeringRatio: number | null;
  leadUnderwriter: string | null;
  status?: IpoStatus;
}

/** 集計期間。recent3y = 基準日から遡って3年（基準日を含む）、all = 全期間（2015年〜）。 */
export type StatsPeriod = "recent3y" | "all";

export const STATS_PERIODS: StatsPeriod[] = ["recent3y", "all"];

export const STATS_PERIOD_LABELS: Record<StatsPeriod, string> = {
  recent3y: "直近3年",
  all: "全期間（2015年〜）",
};

/** 3年前の同月同日（YYYY-MM-DD）。うるう日は文字列比較なので補正不要。 */
export function periodStartDate(referenceDate: string): string {
  const year = Number(referenceDate.slice(0, 4)) - 3;
  return `${String(year).padStart(4, "0")}${referenceDate.slice(4)}`;
}

/**
 * 期間で絞り込む。recent3y は [基準日の3年前, 基準日] の閉区間。
 * all または基準日未指定なら絞り込まない（後方互換）。
 */
export function filterByPeriod<T extends { listingDate: string }>(
  sources: readonly T[],
  period: StatsPeriod,
  referenceDate?: string,
): T[] {
  if (period === "all" || !referenceDate) return [...sources];
  const from = periodStartDate(referenceDate);
  return sources.filter((s) => s.listingDate >= from && s.listingDate <= referenceDate);
}

/** 期間の基準日。上場済みは対象銘柄の上場日、それ以外は今日（未指定なら上場予定日）。 */
export function outcomeReferenceDate(target: OutcomeSource, todayIso?: string): string {
  if (target.status === undefined || target.status === "listed") return target.listingDate;
  return todayIso ?? target.listingDate;
}

/** 吸収金額帯（億円）。 */
export type AbsorptionBand = "under10" | "10to30" | "30to100" | "over100";

export const ABSORPTION_BAND_LABELS: Record<AbsorptionBand, string> = {
  under10: "10億円未満",
  "10to30": "10〜30億円",
  "30to100": "30〜100億円",
  over100: "100億円以上",
};

/** 吸収金額（億円）を帯に分類する。境界値は上側の帯に含める（10億円ちょうど → 10to30）。 */
export function classifyAbsorptionBand(absorptionAmount: number): AbsorptionBand {
  if (absorptionAmount < 10) return "under10";
  if (absorptionAmount < 30) return "10to30";
  if (absorptionAmount < 100) return "30to100";
  return "over100";
}

/** オファリングレシオ帯（%）。 */
export type OfferingRatioBand = "under10" | "10to30" | "30to50" | "over50";

export const OFFERING_RATIO_BAND_LABELS: Record<OfferingRatioBand, string> = {
  under10: "10%未満",
  "10to30": "10〜30%",
  "30to50": "30〜50%",
  over50: "50%以上",
};

const OFFERING_RATIO_BANDS: OfferingRatioBand[] = ["under10", "10to30", "30to50", "over50"];

/** オファリングレシオ（%）を帯に分類する。境界値は上側の帯に含める。 */
export function classifyOfferingRatioBand(offeringRatio: number): OfferingRatioBand {
  if (offeringRatio < 10) return "under10";
  if (offeringRatio < 30) return "10to30";
  if (offeringRatio < 50) return "30to50";
  return "over50";
}

export interface OutcomeSample {
  code: string;
  name: string;
  /** 上場日（YYYY-MM-DD）。コード再利用で code が重複しうるため識別に使う。 */
  listingDate: string;
  /** 初値騰落率（%）。 */
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

/** 主幹事別の公募割れ率。 */
export interface UnderwriterBreakEvenStat {
  underwriter: string;
  sampleCount: number;
  /** 公募割れ率（初値<公開価格の割合、%）。 */
  breakEvenRate: number;
  /** 初値騰落率の平均（%）。 */
  meanReturn: number;
  /** 母数が少なく参考程度であることを示すフラグ（count < 5）。 */
  lowSample: boolean;
}

/** OR帯別の初値騰落率分布。 */
export interface OfferingRatioBandStat {
  band: OfferingRatioBand;
  sampleCount: number;
  medianReturnRate: number | null;
  winRate: number | null;
}

/** 市場別の初値騰落率分布。 */
export interface MarketStat {
  market: Market;
  sampleCount: number;
  winRate: number | null;
  medianReturnRate: number | null;
}

const MAX_SAMPLES = 10;
const LOW_SAMPLE_THRESHOLD = 5;
const MARKETS: Market[] = ["グロース", "スタンダード", "プライム"];

interface Outcome {
  ipo: OutcomeSource;
  returnRate: number;
}

/** 集計対象（上場済みかつ公開価格・初値あり）の銘柄と騰落率を返す。 */
function listedOutcomes(allIpos: readonly OutcomeSource[]): Outcome[] {
  const result: Outcome[] = [];
  for (const ipo of allIpos) {
    if (ipo.status !== undefined && ipo.status !== "listed") continue;
    if (ipo.initialPrice === null || ipo.offeringPrice === null) continue;
    if (!(ipo.offeringPrice > 0)) continue;
    const rate = ((ipo.initialPrice - ipo.offeringPrice) / ipo.offeringPrice) * 100;
    if (!Number.isFinite(rate)) continue;
    result.push({ ipo, returnRate: rate });
  }
  return result;
}

/** 正の数値か（null・0以下は未取得扱い）。 */
function isPositive(value: number | null): value is number {
  return value !== null && value > 0;
}

/** 主幹事名（前後空白除去）。未取得は空文字。 */
function underwriterKey(value: string | null): string {
  return (value ?? "").trim();
}

/** 中央値。空配列は null。偶数件は中央2件の平均。 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 条件を満たす割合（%）。母数0は null。 */
function ratePercent(values: number[], predicate: (v: number) => boolean): number | null {
  if (values.length === 0) return null;
  return (values.filter(predicate).length / values.length) * 100;
}

export interface OutcomeDistributionOptions {
  /** 既定 recent3y。 */
  period?: StatsPeriod;
  /** 未上場銘柄の基準日（今日）。未指定なら上場予定日を使う。 */
  todayIso?: string;
}

/**
 * 「吸収金額帯×市場」が一致する上場済み銘柄の初値実績分布を返す（targetIpo自身は除外）。
 * 地合いは v1 では条件に含めない。対象銘柄の吸収金額が未取得（0以下）なら母数0を返す。
 * 期間は既定 recent3y（基準日は outcomeReferenceDate）。
 */
export function outcomeDistributionByAbsorptionBand(
  allIpos: readonly OutcomeSource[],
  targetIpo: OutcomeSource,
  options: OutcomeDistributionOptions = {},
): OutcomeDistributionResult {
  const empty: OutcomeDistributionResult = {
    sampleCount: 0,
    winRate: null,
    medianReturnRate: null,
    meanReturnRate: null,
    samples: [],
  };
  if (!isPositive(targetIpo.absorptionAmount) || targetIpo.market === null) return empty;
  const band = classifyAbsorptionBand(targetIpo.absorptionAmount);
  const period = options.period ?? "recent3y";
  const scoped = filterByPeriod(
    allIpos,
    period,
    outcomeReferenceDate(targetIpo, options.todayIso),
  );

  const matched = listedOutcomes(scoped).filter(
    ({ ipo }) =>
      ipo.code !== targetIpo.code &&
      ipo.market === targetIpo.market &&
      isPositive(ipo.absorptionAmount) &&
      classifyAbsorptionBand(ipo.absorptionAmount) === band,
  );
  if (matched.length === 0) return empty;

  const rates = matched.map((o) => o.returnRate);
  const samples = [...matched]
    .sort((a, b) => b.ipo.listingDate.localeCompare(a.ipo.listingDate))
    .slice(0, MAX_SAMPLES)
    .map(({ ipo, returnRate }) => ({
      code: ipo.code,
      name: ipo.name,
      listingDate: ipo.listingDate,
      returnRate,
    }));

  return {
    sampleCount: matched.length,
    winRate: ratePercent(rates, (r) => r > 0),
    medianReturnRate: median(rates),
    meanReturnRate: mean(rates),
    samples,
  };
}

function buildUnderwriterStat(underwriter: string, rates: number[]): UnderwriterBreakEvenStat {
  return {
    underwriter,
    sampleCount: rates.length,
    breakEvenRate: ratePercent(rates, (r) => r < 0) ?? 0,
    meanReturn: mean(rates) ?? 0,
    lowSample: rates.length < LOW_SAMPLE_THRESHOLD,
  };
}

/**
 * 主幹事別の公募割れ率（初値<公開価格の割合）。上場済み・公開価格/初値あり銘柄のみ対象。
 * 母数が minSample 未満の主幹事は除外。並びは母数の多い順（同数は名前順）。
 */
export function underwriterBreakEvenStats(
  allIpos: readonly OutcomeSource[],
  minSample = 2,
): UnderwriterBreakEvenStat[] {
  const groups = new Map<string, number[]>();
  for (const { ipo, returnRate } of listedOutcomes(allIpos)) {
    const name = underwriterKey(ipo.leadUnderwriter);
    if (name === "") continue;
    const list = groups.get(name) ?? [];
    list.push(returnRate);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .filter(([, rates]) => rates.length >= minSample)
    .map(([name, rates]) => buildUnderwriterStat(name, rates))
    .sort((a, b) => b.sampleCount - a.sampleCount || a.underwriter.localeCompare(b.underwriter, "ja"));
}

export interface UnderwriterStatOptions {
  /** 既定 recent3y。referenceDate 未指定なら期間で絞り込まない（後方互換）。 */
  period?: StatsPeriod;
  /** 期間の基準日（YYYY-MM-DD）。 */
  referenceDate?: string;
}

/** 特定の主幹事1社分の統計を返す。母数0なら null。 */
export function underwriterBreakEvenStat(
  allIpos: readonly OutcomeSource[],
  underwriter: string | null,
  options: UnderwriterStatOptions = {},
): UnderwriterBreakEvenStat | null {
  const key = underwriterKey(underwriter);
  if (key === "") return null;
  const scoped = filterByPeriod(allIpos, options.period ?? "recent3y", options.referenceDate);
  const rates = listedOutcomes(scoped)
    .filter(({ ipo }) => underwriterKey(ipo.leadUnderwriter) === key)
    .map((o) => o.returnRate);
  if (rates.length === 0) return null;
  return buildUnderwriterStat(key, rates);
}

/** OR帯別の初値騰落率分布。4帯すべてを固定順で返す（母数0の帯は null）。OR未取得（0以下）は除外。 */
export function offeringRatioBandStats(allIpos: readonly OutcomeSource[]): OfferingRatioBandStat[] {
  const groups = new Map<OfferingRatioBand, number[]>(OFFERING_RATIO_BANDS.map((b) => [b, []]));
  for (const { ipo, returnRate } of listedOutcomes(allIpos)) {
    if (!isPositive(ipo.offeringRatio)) continue;
    groups.get(classifyOfferingRatioBand(ipo.offeringRatio))?.push(returnRate);
  }
  return OFFERING_RATIO_BANDS.map((band) => {
    const rates = groups.get(band) ?? [];
    return {
      band,
      sampleCount: rates.length,
      medianReturnRate: median(rates),
      winRate: ratePercent(rates, (r) => r > 0),
    };
  });
}

/** 市場別の初値騰落率分布。3市場すべてを固定順で返す（母数0の市場は null）。 */
export function marketStats(allIpos: readonly OutcomeSource[]): MarketStat[] {
  const outcomes = listedOutcomes(allIpos);
  return MARKETS.map((market) => {
    const rates = outcomes.filter(({ ipo }) => ipo.market === market).map((o) => o.returnRate);
    return {
      market,
      sampleCount: rates.length,
      winRate: ratePercent(rates, (r) => r > 0),
      medianReturnRate: median(rates),
    };
  });
}

/** 期間ごとの類似条件実績（詳細ページ表示用）。 */
export interface PeriodOutcome {
  period: StatsPeriod;
  /** 期間の開始日（all は null）。 */
  fromDate: string | null;
  /** 期間の終了日＝基準日（all は null）。 */
  toDate: string | null;
  distribution: OutcomeDistributionResult;
  /** 同じ主幹事の公募割れ率（対象銘柄自身は除外）。母数0は null。 */
  underwriter: UnderwriterBreakEvenStat | null;
}

export type OutcomeByPeriod = Record<StatsPeriod, PeriodOutcome>;

/** 直近3年・全期間の両方を集計する（サーバー側で呼び、結果だけをクライアントへ渡す）。 */
export function outcomeByPeriod(
  allIpos: readonly OutcomeSource[],
  targetIpo: OutcomeSource,
  todayIso: string,
): OutcomeByPeriod {
  const referenceDate = outcomeReferenceDate(targetIpo, todayIso);
  const others = allIpos.filter((i) => i.code !== targetIpo.code);
  const build = (period: StatsPeriod): PeriodOutcome => ({
    period,
    fromDate: period === "recent3y" ? periodStartDate(referenceDate) : null,
    toDate: period === "recent3y" ? referenceDate : null,
    distribution: outcomeDistributionByAbsorptionBand(allIpos, targetIpo, { period, todayIso }),
    underwriter: underwriterBreakEvenStat(others, targetIpo.leadUnderwriter, {
      period,
      referenceDate,
    }),
  });
  return { recent3y: build("recent3y"), all: build("all") };
}
