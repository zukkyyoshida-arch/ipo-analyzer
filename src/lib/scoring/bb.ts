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
// 8項目を -2〜+2 に正規化し、重み付き合計を buildAxis と同じ方式で 0〜100 に換算する。
// 未取得の項目は 0 点（中立）で rawText「未取得」とする。
// 閾値・重みの根拠は scratch/backtest/report-phase2.md（recalibrate_bb.py）と
// scratch/backtest/report-phase3.md（recalibrate_bb_v2.py、2015〜2026年 1026銘柄）。

export type BbScoreItemKey =
  | "absorption"
  | "offeringRatioBb"
  | "underwriterTrack"
  | "priceRangePosition"
  | "vcLockup"
  | "sentiment"
  | "saleRatio"
  | "recentIpoSentiment";

export const BB_SCORE_KEYS: BbScoreItemKey[] = [
  "absorption",
  "offeringRatioBb",
  "underwriterTrack",
  "priceRangePosition",
  "vcLockup",
  "sentiment",
  "saleRatio",
  "recentIpoSentiment",
];

export const BB_SCORE_ITEM_LABELS: Record<BbScoreItemKey, string> = {
  absorption: "吸収金額",
  offeringRatioBb: "オファリングレシオ",
  underwriterTrack: "主幹事の公募割れ実績",
  priceRangePosition: "仮条件の位置",
  vcLockup: "VC比率×ロックアップ",
  sentiment: "地合い",
  saleRatio: "売出比率",
  recentIpoSentiment: "直近IPOの初値動向",
};

export type BbScoreWeights = Record<BbScoreItemKey, number>;

/**
 * 実証済みの重み。
 * 既存6項目は 2024-01〜2026-07 上場168銘柄のバックテストで確定（主幹事実績のみ 3→2。report-phase2.md）。
 * 売出比率・直近IPOの初値動向は 2015〜2026年 1026銘柄で Spearman +0.26 / +0.30、
 * 年別でも 11/12年・10/12年で同じ向きだったため重み2で追加（report-phase3.md）。
 * 幹事団社数・同週上場件数は相関が弱く（|Spearman|<0.10）スコアには入れない。
 */
export const DEFAULT_BB_WEIGHTS: BbScoreWeights = {
  absorption: 4,
  offeringRatioBb: 4,
  underwriterTrack: 2,
  priceRangePosition: 3,
  vcLockup: 2,
  sentiment: 2,
  saleRatio: 2,
  recentIpoSentiment: 2,
};

/**
 * 銘柄の外側から与える文脈（全銘柄から算出する値）。省略時は該当項目を未取得（0点）として扱う。
 * buildBbContext で全銘柄リストから作れる。
 */
export interface BbScoreContext {
  /** 上場日より前に上場した直近5件の初値騰落率平均（%）。算出できなければ null。 */
  recentIpoAvgReturn?: number | null;
  /** 同じ週（月〜日）に上場する件数（自分を含む）。 */
  sameWeekListings?: number;
}

/** 直近IPOの初値動向に使う件数。 */
export const RECENT_IPO_COUNT = 5;

/**
 * 新項目の閾値（2015〜2023年の五分位を丸めた値。bb-model.json の thresholds と一致させる）。
 * 売出比率(%): <20=+2 / <40=+1 / <55=0 / <75=-1 / それ以上=-2
 * 幹事団社数: <=6=+2 / <=7=+1 / <=8=0 / <=9=-1 / それ以上=-2（確率モデルのみで使用）
 * 同週上場件数: <=2=+2 / <=4=+1 / <=5=0 / <=8=-1 / それ以上=-2（確率モデルのみで使用）
 * 直近5件の初値騰落率平均(%): >=120=+2 / >=80=+1 / >=55=0 / >=30=-1 / それ未満=-2
 */
export const SALE_RATIO_CUTS = [20, 40, 55, 75] as const;
export const UNDERWRITER_COUNT_CUTS = [6, 7, 8, 9] as const;
export const SAME_WEEK_CUTS = [2, 4, 5, 8] as const;
export const RECENT_IPO_CUTS = [120, 80, 55, 30] as const;

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
export function scoreAbsorptionBb(ipo: Ipo): ItemOutput {
  if (!(ipo.absorptionAmount > 0)) return missing("吸収金額");
  return scoreAbsorption(ipo);
}

/** VC比率×ロックアップ: 既存 scoreVcLockup を再利用。ロックアップ日数が未取得（0以下）は 0 点。 */
export function scoreVcLockupBb(ipo: Ipo): ItemOutput {
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

/** 小さいほど良い値を cuts（昇順4つ）で -2〜+2 に写像する。inclusive=true は「以下」、false は「未満」。 */
function lowIsGood(value: number, cuts: readonly number[], inclusive: boolean): number {
  const within = (v: number, t: number) => (inclusive ? v <= t : v < t);
  if (within(value, cuts[0])) return 2;
  if (within(value, cuts[1])) return 1;
  if (within(value, cuts[2])) return 0;
  if (within(value, cuts[3])) return -1;
  return -2;
}

/** 売出比率（%）= 売出 ÷ (公募 + 売出) × 100。株数が未取得なら null。 */
export function saleRatioOf(ipo: Ipo): number | null {
  const total = ipo.publicShares + ipo.saleShares;
  if (!(total > 0) || ipo.saleShares < 0) return null;
  return (ipo.saleShares / total) * 100;
}

/** 売出比率: 既存株主の売り出しが多いほど需給は緩みやすい。<20%=+2 / <40%=+1 / <55%=0 / <75%=-1 / それ以上=-2。 */
export function scoreSaleRatio(ipo: Ipo): ItemOutput {
  const r = saleRatioOf(ipo);
  if (r === null) return missing("公募・売出株数");
  const points = lowIsGood(r, SALE_RATIO_CUTS, false);
  return {
    points,
    rawText: `${formatRate(r)}%`,
    reason: `売出比率 ${formatRate(r)}%（売出÷(公募+売出)）。2015〜2026年の実績分布では75%以上の群で公募割れ率が高い（機械的集計）。`,
  };
}

/**
 * 直近IPOの初値動向: 上場日より前に上場した直近5件の初値騰落率平均。
 * >=120%=+2 / >=80%=+1 / >=55%=0 / >=30%=-1 / それ未満=-2。未取得は 0 点。
 */
export function scoreRecentIpoSentiment(avg: number | null | undefined): ItemOutput {
  if (avg === null || avg === undefined || !Number.isFinite(avg)) {
    return missing("直近IPOの初値実績");
  }
  const [c1, c2, c3, c4] = RECENT_IPO_CUTS;
  let points: number;
  if (avg >= c1) points = 2;
  else if (avg >= c2) points = 1;
  else if (avg >= c3) points = 0;
  else if (avg >= c4) points = -1;
  else points = -2;
  const sign = avg >= 0 ? "+" : "";
  return {
    points,
    rawText: `直近${RECENT_IPO_COUNT}件平均 ${sign}${formatRate(avg)}%`,
    reason: `上場日より前に上場した直近${RECENT_IPO_COUNT}件の初値騰落率平均 ${sign}${formatRate(avg)}%（IPO市場の地合い。実績分布の機械的集計）。`,
  };
}

/** 幹事団社数（確率モデル用。スコアには入れない）。<=6=+2 / 7=+1 / 8=0 / 9=-1 / 10以上=-2。 */
export function scoreUnderwriterCount(ipo: Ipo): ItemOutput {
  const n = ipo.underwriters.length;
  if (!(n > 0)) return missing("幹事団");
  return {
    points: lowIsGood(n, UNDERWRITER_COUNT_CUTS, true),
    rawText: `${n}社`,
    reason: `幹事団 ${n}社。`,
  };
}

/** 同週上場件数（確率モデル用。スコアには入れない）。<=2=+2 / <=4=+1 / 5=0 / <=8=-1 / 9以上=-2。 */
export function scoreSameWeekListings(count: number | null | undefined): ItemOutput {
  if (count === null || count === undefined || !(count > 0)) return missing("同週上場件数");
  return {
    points: lowIsGood(count, SAME_WEEK_CUTS, true),
    rawText: `${count}件`,
    reason: `同じ週の上場 ${count}件（自分を含む）。`,
  };
}

/** YYYY-MM-DD を含む週（月曜始まり）の月曜日を YYYY-MM-DD で返す。不正な日付は null。 */
function mondayOf(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const diff = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** 同じ週（月〜日）に上場する銘柄数（自分を含む）。上場日が未定なら undefined。 */
export function countSameWeekListings(allIpos: Ipo[], listingDate: string): number | undefined {
  const week = mondayOf(listingDate);
  if (week === null) return undefined;
  const codes = new Set<string>();
  for (const other of allIpos) {
    if (mondayOf(other.listingDate) === week) codes.add(`${other.code}:${other.listingDate}`);
  }
  return Math.max(1, codes.size);
}

/**
 * 上場日より前に上場した直近 n 件の初値騰落率平均（%）。上場日当日以降は含めない（リーク防止）。
 * 初値・公開価格が揃う銘柄が n 件に満たなければ null。
 */
export function recentIpoAvgReturnBefore(
  allIpos: Ipo[],
  listingDate: string,
  n: number = RECENT_IPO_COUNT,
): number | null {
  if (!listingDate) return null;
  const prior = allIpos
    .filter(
      (o) =>
        o.listingDate !== "" &&
        o.listingDate < listingDate &&
        o.offeringPrice !== null &&
        o.offeringPrice > 0 &&
        o.initialPrice !== null &&
        o.initialPrice > 0,
    )
    .sort((a, b) =>
      a.listingDate === b.listingDate ? a.code.localeCompare(b.code) : a.listingDate.localeCompare(b.listingDate),
    )
    .slice(-n);
  if (prior.length < n) return null;
  const sum = prior.reduce(
    (acc, o) => acc + (((o.initialPrice as number) - (o.offeringPrice as number)) / (o.offeringPrice as number)) * 100,
    0,
  );
  return sum / prior.length;
}

/** 全銘柄リストから BbScoreContext を作る純関数。 */
export function buildBbContext(ipo: Ipo, allIpos: Ipo[]): BbScoreContext {
  return {
    recentIpoAvgReturn: recentIpoAvgReturnBefore(allIpos, ipo.listingDate),
    sameWeekListings: countSameWeekListings(allIpos, ipo.listingDate),
  };
}

function computeBbItem(
  key: BbScoreItemKey,
  ipo: Ipo,
  settings: ScoreSettings,
  underwriterStat: UnderwriterBreakEvenStat | null,
  context: BbScoreContext,
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
    case "saleRatio":
      return scoreSaleRatio(ipo);
    case "recentIpoSentiment":
      return scoreRecentIpoSentiment(context.recentIpoAvgReturn);
  }
}

const POINT_MIN = -2;
const POINT_MAX = 2;

/**
 * BB参加スコアを算出する純関数。
 * 0〜100 換算は scoring/index.ts の buildAxis と同じ（全重み0なら中立の50点）。
 * context 省略時（旧呼び出し）は直近IPOの初値動向を未取得（0点）として扱う。
 * weights に無いキーは重み0（旧6項目だけの重みを渡せば旧スコアと一致する）。
 */
export function scoreBbParticipation(
  ipo: Ipo,
  settings: ScoreSettings,
  underwriterStat: UnderwriterBreakEvenStat | null,
  weights: Partial<BbScoreWeights> = DEFAULT_BB_WEIGHTS,
  context: BbScoreContext = {},
): BbScoreResult {
  const items: BbScoreItemOutput[] = BB_SCORE_KEYS.map((key) => {
    const out = computeBbItem(key, ipo, settings, underwriterStat, context);
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
