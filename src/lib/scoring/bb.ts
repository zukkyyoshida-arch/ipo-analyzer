import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "./types";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";
import {
  type ItemOutput,
  scoreAbsorption,
  scoreVcLockup,
  scoreSentiment,
} from "./items";

// BB参加スコア（独立した第3軸）。既存の需給/ファンダ2軸は変更しない。
// 6項目を -2〜+2 に正規化し、重み付き合計を buildAxis と同じ方式で 0〜100 に換算する。
// 未取得の項目は 0 点（中立）で rawText「未取得」とする。
// 閾値・重みの根拠は scratch/backtest/report-phase2.md（recalibrate_bb.py）。

export type BbScoreItemKey =
  | "absorption"
  | "offeringRatioBb"
  | "underwriterTrack"
  | "priceRangePosition"
  | "vcLockup"
  | "sentiment";

export const BB_SCORE_KEYS: BbScoreItemKey[] = [
  "absorption",
  "offeringRatioBb",
  "underwriterTrack",
  "priceRangePosition",
  "vcLockup",
  "sentiment",
];

export const BB_SCORE_ITEM_LABELS: Record<BbScoreItemKey, string> = {
  absorption: "吸収金額",
  offeringRatioBb: "オファリングレシオ",
  underwriterTrack: "主幹事の公募割れ実績",
  priceRangePosition: "仮条件の位置",
  vcLockup: "VC比率×ロックアップ",
  sentiment: "地合い",
};

export type BbScoreWeights = Record<BbScoreItemKey, number>;

/**
 * 実証済みの重み（2024-01〜2026-07 上場168銘柄のバックテストで確定）。
 * 設計書 §3.2 の暫定値から、相関が弱かった主幹事実績だけを 3→2 に1段階下げた
 * （§3.4 の規律。年別3年とも順位相関が改善）。詳細は scratch/backtest/report-phase2.md。
 */
export const DEFAULT_BB_WEIGHTS: BbScoreWeights = {
  absorption: 4,
  offeringRatioBb: 4,
  underwriterTrack: 2,
  priceRangePosition: 3,
  vcLockup: 2,
  sentiment: 2,
};

/** 主幹事実績を点数化する最小母数（stats の lowSample 判定と同じ5件）。 */
export const UNDERWRITER_MIN_SAMPLE = 5;

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
  score: number; // 0〜100
  items: BbScoreItemOutput[];
}

const MISSING_TEXT = "未取得";

function missing(label: string): ItemOutput {
  return {
    points: 0,
    rawText: MISSING_TEXT,
    reason: `${label}が未取得のため中立（0点）として集計。`,
  };
}

/** 小数1桁までに丸めた表示用文字列。 */
function formatRate(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** 吸収金額: 既存 scoreAbsorption を再利用。未取得（0以下）は 0 点。 */
function scoreAbsorptionBb(ipo: Ipo): ItemOutput {
  if (!(ipo.absorptionAmount > 0)) return missing("吸収金額");
  return scoreAbsorption(ipo);
}

/** VC比率×ロックアップ: 既存 scoreVcLockup を再利用。ロックアップ日数が未取得（0以下）は 0 点。 */
function scoreVcLockupBb(ipo: Ipo): ItemOutput {
  if (!(ipo.lockup.days > 0)) return missing("ロックアップ");
  return scoreVcLockup(ipo);
}

/** オファリングレシオ: <10%=+2 / <20%=+1 / <30%=0 / <50%=-1 / それ以上=-2。未取得（0以下）は 0 点。 */
export function scoreOfferingRatioBb(ipo: Ipo): ItemOutput {
  const r = ipo.offeringRatio;
  if (!(r > 0)) return missing("オファリングレシオ");
  let points: number;
  if (r < 10) points = 2;
  else if (r < 20) points = 1;
  else if (r < 30) points = 0;
  else if (r < 50) points = -1;
  else points = -2;
  return {
    points,
    rawText: `${formatRate(r)}%`,
    reason: `オファリングレシオ ${formatRate(r)}%。上場時に市場へ出る株の比率が低いほど需給はタイトになりやすい。`,
  };
}

/**
 * 主幹事別公募割れ率の実績。stats の結果を引数で受け取る純関数。
 * 母数5件未満・実績なしは参考外として 0 点。
 * 公募割れ率 <5%=+2 / <10%=+1 / <20%=0 / <30%=-1 / それ以上=-2。
 */
export function scoreUnderwriterTrack(
  stat: UnderwriterBreakEvenStat | null,
): ItemOutput {
  if (stat === null || stat.sampleCount === 0) {
    return {
      points: 0,
      rawText: "実績なし",
      reason: "主幹事の上場実績データがないため中立（0点）として集計。",
    };
  }
  const rate = stat.breakEvenRate;
  const rawText = `公募割れ率${formatRate(rate)}%（母数${stat.sampleCount}件）`;
  if (stat.sampleCount < UNDERWRITER_MIN_SAMPLE) {
    return {
      points: 0,
      rawText,
      reason: `${stat.underwriter}の実績は母数${stat.sampleCount}件で${UNDERWRITER_MIN_SAMPLE}件未満のため、参考外として中立（0点）。`,
    };
  }
  let points: number;
  if (rate < 5) points = 2;
  else if (rate < 10) points = 1;
  else if (rate < 20) points = 0;
  else if (rate < 30) points = -1;
  else points = -2;
  return {
    points,
    rawText,
    reason: `${stat.underwriter}が主幹事の上場済み銘柄の公募割れ率は${formatRate(rate)}%（実績分布の機械的集計）。`,
  };
}

/**
 * 仮条件の位置。checklist の checkPriceRangeRevision と同じ境界で判定する。
 * 上振れ（仮条件下限 > 想定価格）=+2 / 下振れ（仮条件上限 < 想定価格）=-2 / レンジ内=0 / 未取得=0。
 */
export function scorePriceRangePosition(ipo: Ipo): ItemOutput {
  const { assumedPrice, priceRange } = ipo;
  if (assumedPrice <= 0 || priceRange.high <= 0) return missing("仮条件");
  // 仮条件未発表時は merge が想定価格を low=high として埋めるため、レンジとしては未取得扱い。
  if (priceRange.low === priceRange.high && priceRange.low === assumedPrice) {
    return {
      points: 0,
      rawText: MISSING_TEXT,
      reason: "仮条件レンジが未取得（想定価格と同値のみ）のため中立（0点）として集計。",
    };
  }
  const rangeText = `想定${assumedPrice.toLocaleString()}円 / 仮条件${priceRange.low.toLocaleString()}〜${priceRange.high.toLocaleString()}円`;
  if (priceRange.low > assumedPrice) {
    return {
      points: 2,
      rawText: rangeText,
      reason: "仮条件が想定価格より上振れ（機関投資家の需要が強い兆候）。",
    };
  }
  if (priceRange.high < assumedPrice) {
    return {
      points: -2,
      rawText: rangeText,
      reason: "仮条件が想定価格より下振れ（需要が弱い兆候）。",
    };
  }
  return {
    points: 0,
    rawText: rangeText,
    reason: "想定価格が仮条件レンジ内（中立）。",
  };
}

function computeBbItem(
  key: BbScoreItemKey,
  ipo: Ipo,
  settings: ScoreSettings,
  underwriterStat: UnderwriterBreakEvenStat | null,
): ItemOutput {
  switch (key) {
    case "absorption":
      return scoreAbsorptionBb(ipo);
    case "offeringRatioBb":
      return scoreOfferingRatioBb(ipo);
    case "underwriterTrack":
      return scoreUnderwriterTrack(underwriterStat);
    case "priceRangePosition":
      return scorePriceRangePosition(ipo);
    case "vcLockup":
      return scoreVcLockupBb(ipo);
    case "sentiment":
      return scoreSentiment(settings);
  }
}

const POINT_MIN = -2;
const POINT_MAX = 2;

/**
 * BB参加スコアを算出する純関数。
 * 0〜100 換算は scoring/index.ts の buildAxis と同じ（全重み0なら中立の50点）。
 */
export function scoreBbParticipation(
  ipo: Ipo,
  settings: ScoreSettings,
  underwriterStat: UnderwriterBreakEvenStat | null,
  weights: BbScoreWeights = DEFAULT_BB_WEIGHTS,
): BbScoreResult {
  const items: BbScoreItemOutput[] = BB_SCORE_KEYS.map((key) => {
    const out = computeBbItem(key, ipo, settings, underwriterStat);
    const weight = weights[key] ?? 0;
    return {
      key,
      label: BB_SCORE_ITEM_LABELS[key],
      points: out.points,
      weight,
      contribution: out.points * weight,
      rawText: out.rawText,
      reason: out.reason,
    };
  });

  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  const rawTotal = items.reduce((sum, i) => sum + i.contribution, 0);
  const maxTotal = totalWeight * POINT_MAX;
  const minTotal = totalWeight * POINT_MIN;
  const range = maxTotal - minTotal;
  const score =
    range === 0 ? 50 : Math.round(((rawTotal - minTotal) / range) * 100);

  return { score: Math.min(100, Math.max(0, score)), items };
}
