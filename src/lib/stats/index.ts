import type { Ipo, Market } from "@/types/ipo";
import { initialReturnRate } from "@/lib/format";

// 上場済み銘柄の初値実績を機械的に集計する純関数群。
// 母数0は null / sampleCount:0 を返し、例外は投げない。
// 吸収金額・ORが 0 以下の銘柄は「未取得（既定値）」とみなし、帯別集計の対象から外す。

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
  ipo: Ipo;
  returnRate: number;
}

/** 集計対象（上場済みかつ公開価格・初値あり）の銘柄と騰落率を返す。 */
function listedOutcomes(allIpos: Ipo[]): Outcome[] {
  const result: Outcome[] = [];
  for (const ipo of allIpos) {
    if (ipo.status !== "listed") continue;
    const rate = initialReturnRate(ipo);
    if (rate === null || !Number.isFinite(rate)) continue;
    result.push({ ipo, returnRate: rate });
  }
  return result;
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

/**
 * 「吸収金額帯×市場」が一致する上場済み銘柄の初値実績分布を返す（targetIpo自身は除外）。
 * 地合いは v1 では条件に含めない。対象銘柄の吸収金額が未取得（0以下）なら母数0を返す。
 */
export function outcomeDistributionByAbsorptionBand(
  allIpos: Ipo[],
  targetIpo: Ipo,
): OutcomeDistributionResult {
  const empty: OutcomeDistributionResult = {
    sampleCount: 0,
    winRate: null,
    medianReturnRate: null,
    meanReturnRate: null,
    samples: [],
  };
  if (!(targetIpo.absorptionAmount > 0)) return empty;
  const band = classifyAbsorptionBand(targetIpo.absorptionAmount);

  const matched = listedOutcomes(allIpos).filter(
    ({ ipo }) =>
      ipo.code !== targetIpo.code &&
      ipo.market === targetIpo.market &&
      ipo.absorptionAmount > 0 &&
      classifyAbsorptionBand(ipo.absorptionAmount) === band,
  );
  if (matched.length === 0) return empty;

  const rates = matched.map((o) => o.returnRate);
  const samples = [...matched]
    .sort((a, b) => b.ipo.listingDate.localeCompare(a.ipo.listingDate))
    .slice(0, MAX_SAMPLES)
    .map(({ ipo, returnRate }) => ({ code: ipo.code, name: ipo.name, returnRate }));

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
  allIpos: Ipo[],
  minSample = 2,
): UnderwriterBreakEvenStat[] {
  const groups = new Map<string, number[]>();
  for (const { ipo, returnRate } of listedOutcomes(allIpos)) {
    const name = ipo.leadUnderwriter.trim();
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

/** 特定の主幹事1社分の統計を返す。母数0なら null。 */
export function underwriterBreakEvenStat(
  allIpos: Ipo[],
  underwriter: string,
): UnderwriterBreakEvenStat | null {
  const key = underwriter.trim();
  if (key === "") return null;
  const rates = listedOutcomes(allIpos)
    .filter(({ ipo }) => ipo.leadUnderwriter.trim() === key)
    .map((o) => o.returnRate);
  if (rates.length === 0) return null;
  return buildUnderwriterStat(key, rates);
}

/** OR帯別の初値騰落率分布。4帯すべてを固定順で返す（母数0の帯は null）。OR未取得（0以下）は除外。 */
export function offeringRatioBandStats(allIpos: Ipo[]): OfferingRatioBandStat[] {
  const groups = new Map<OfferingRatioBand, number[]>(OFFERING_RATIO_BANDS.map((b) => [b, []]));
  for (const { ipo, returnRate } of listedOutcomes(allIpos)) {
    if (!(ipo.offeringRatio > 0)) continue;
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
export function marketStats(allIpos: Ipo[]): MarketStat[] {
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
