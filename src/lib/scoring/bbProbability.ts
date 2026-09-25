import type { Ipo } from "@/types/ipo";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";
import type { ItemOutput } from "./items";
import model from "./bb-model.json";
import {
  type BbScoreContext,
  scoreAbsorptionBb,
  scoreOfferingRatioBb,
  scorePriceRangePosition,
  scoreRecentIpoSentiment,
  scoreSaleRatio,
  scoreSameWeekListings,
  scoreUnderwriterCount,
  scoreUnderwriterTrack,
  scoreVcLockupBb,
} from "./bb";

// 公募割れ確率（実績ベース）。2015〜2023年の上場銘柄で学習したロジスティック回帰の係数
// （bb-model.json）を読み、BB参加スコアの項目 points から確率を出す純関数。
// 学習・検証は scratch/backtest/recalibrate_bb_v2.py、根拠と限界は scratch/backtest/report-phase3.md。
// 参考情報（実績分布の機械的集計）であり、将来の結果を保証しない。

export interface BbProbabilityContext extends BbScoreContext {
  /** 主幹事の公募割れ実績（自身を除く）。null / 省略は実績なし扱い。 */
  underwriterStat?: UnderwriterBreakEvenStat | null;
}

export interface BreakEvenProbability {
  /** 公募割れ確率（0〜1） */
  probability: number;
  /** 学習に使った銘柄数 */
  sampleCount: number;
  /** 学習期間の開始日（YYYY-MM-DD） */
  trainedFrom: string;
  /** 学習期間の終了日（YYYY-MM-DD） */
  trainedThrough: string;
  /** 検証期間（学習に使っていない期間）の AUC */
  auc: number;
  /** 検証に使った銘柄数 */
  validationCount: number;
  /** 未取得で中立扱いにした特徴量の数 */
  missingCount: number;
}

interface ModelFeature {
  key: string;
  coef: number;
  mean: number;
  sd: number;
}

/** 未取得の特徴量がこれを超えたら確率を出さない。 */
export const MAX_MISSING_FEATURES = 2;

const MISSING_TEXT = "未取得";

/** 項目 points と、未取得かどうか。 */
interface FeatureValue {
  points: number;
  missing: boolean;
}

function fromItem(out: ItemOutput): FeatureValue {
  return { points: out.points, missing: out.rawText === MISSING_TEXT };
}

/** モデルの特徴量キー → points。学習時（recalibrate_bb_v2.py）と同じ閾値・同じ未取得=0点。 */
function featureValue(key: string, ipo: Ipo, context: BbProbabilityContext): FeatureValue | null {
  switch (key) {
    case "absorption":
      return fromItem(scoreAbsorptionBb(ipo));
    case "offeringRatioBb":
      return fromItem(scoreOfferingRatioBb(ipo));
    case "underwriterTrack": {
      const stat = context.underwriterStat ?? null;
      // 母数5件未満は学習時も 0 点。実績そのものが無いときだけ未取得に数える。
      return { points: scoreUnderwriterTrack(stat).points, missing: stat === null };
    }
    case "priceRangePosition":
      return fromItem(scorePriceRangePosition(ipo));
    case "vcLockup":
      return fromItem(scoreVcLockupBb(ipo));
    case "saleRatio":
      return fromItem(scoreSaleRatio(ipo));
    case "underwriterCount":
      return fromItem(scoreUnderwriterCount(ipo));
    case "sameWeekListings":
      return fromItem(scoreSameWeekListings(context.sameWeekListings));
    case "recentIpoSentiment":
      return fromItem(scoreRecentIpoSentiment(context.recentIpoAvgReturn));
    default:
      return null;
  }
}

/**
 * 公募割れ確率（実績ベース）を推定する純関数。
 * 吸収金額が未取得、または未取得の特徴量が MAX_MISSING_FEATURES を超える銘柄は null。
 */
export function estimateBreakEvenProbability(
  ipo: Ipo,
  context: BbProbabilityContext = {},
): BreakEvenProbability | null {
  if (!(ipo.absorptionAmount > 0)) return null;
  const features = model.features as ModelFeature[];
  let z = model.intercept;
  let missingCount = 0;
  for (const f of features) {
    const v = featureValue(f.key, ipo, context);
    if (v === null) return null; // 未知の特徴量（モデルと実装の不一致）は出さない
    if (v.missing) missingCount += 1;
    const sd = f.sd > 0 ? f.sd : 1;
    z += f.coef * ((v.points - f.mean) / sd);
  }
  if (missingCount > MAX_MISSING_FEATURES) return null;
  const probability = 1 / (1 + Math.exp(-z));
  return {
    probability,
    sampleCount: model.sampleCount,
    trainedFrom: model.trainedFrom,
    trainedThrough: model.trainedThrough,
    auc: model.validation.auc,
    validationCount: model.validation.sampleCount,
    missingCount,
  };
}
