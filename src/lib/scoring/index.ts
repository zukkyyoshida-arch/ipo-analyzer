import type { Ipo } from "@/types/ipo";
import type {
  AxisScoreResult,
  IpoScoreResult,
  ScoreItemKey,
  ScoreItemResult,
  ScoreSettings,
} from "./types";
import {
  SCORE_ITEM_LABELS,
  SUPPLY_DEMAND_KEYS,
  FUNDAMENTAL_KEYS,
} from "./weights";
import {
  type ItemOutput,
  scoreAbsorption,
  scoreMarket,
  scoreTheme,
  scoreVcLockup,
  scoreOfferingStructure,
  scoreUnderwriter,
  scoreSentiment,
  scoreSchedule,
  scoreDownside,
  scoreGrowth,
  scoreValuation,
} from "./items";

export * from "./types";
export * from "./weights";
export {
  POPULAR_THEMES,
  UNPOPULAR_THEME,
  classifyLockStrength,
} from "./items";

// 各項目キー -> 計算関数。settings に依存する項目は settings を参照する。
function computeItemOutput(
  key: ScoreItemKey,
  ipo: Ipo,
  settings: ScoreSettings,
): ItemOutput {
  switch (key) {
    case "absorption":
      return scoreAbsorption(ipo);
    case "market":
      return scoreMarket(ipo);
    case "theme":
      return scoreTheme(ipo);
    case "vcLockup":
      return scoreVcLockup(ipo);
    case "offeringStructure":
      return scoreOfferingStructure(ipo);
    case "underwriter":
      return scoreUnderwriter(ipo, settings);
    case "sentiment":
      return scoreSentiment(settings);
    case "schedule":
      return scoreSchedule(ipo);
    case "downside":
      return scoreDownside(ipo);
    case "growth":
      return scoreGrowth(ipo);
    case "valuation":
      return scoreValuation(ipo);
  }
}

// 各項目の点数は -2〜+2。0〜100 換算のため、重み付き寄与の
// [最小(-2×Σw), 最大(+2×Σw)] を [0,100] に線形マップする。
const POINT_MIN = -2;
const POINT_MAX = 2;

function buildAxis(
  keys: ScoreItemKey[],
  ipo: Ipo,
  settings: ScoreSettings,
): AxisScoreResult {
  const items: ScoreItemResult[] = keys.map((key) => {
    const out = computeItemOutput(key, ipo, settings);
    const weight = settings.weights[key] ?? 0;
    return {
      key,
      label: SCORE_ITEM_LABELS[key],
      rawText: out.rawText,
      points: out.points,
      weight,
      contribution: out.points * weight,
      reason: out.reason,
    };
  });

  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  const rawTotal = items.reduce((sum, i) => sum + i.contribution, 0);
  const maxTotal = totalWeight * POINT_MAX;
  const minTotal = totalWeight * POINT_MIN;

  // 全重み0なら中立の50点を返す（ゼロ除算回避）。
  const range = maxTotal - minTotal;
  const score =
    range === 0 ? 50 : Math.round(((rawTotal - minTotal) / range) * 100);

  return {
    score: clamp01to100(score),
    items,
    rawTotal,
    maxTotal,
    minTotal,
  };
}

function clamp01to100(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/**
 * 銘柄のスコアを算出する純関数。
 * 需給スコアとファンダスコアの2軸を、それぞれ 0〜100 に換算して返す。
 */
export function scoreIpo(ipo: Ipo, settings: ScoreSettings): IpoScoreResult {
  return {
    supplyDemand: buildAxis(SUPPLY_DEMAND_KEYS, ipo, settings),
    fundamental: buildAxis(FUNDAMENTAL_KEYS, ipo, settings),
  };
}

/** 一覧のソート等で使う総合スコア（2軸の単純平均）。 */
export function overallScore(result: IpoScoreResult): number {
  return Math.round((result.supplyDemand.score + result.fundamental.score) / 2);
}
