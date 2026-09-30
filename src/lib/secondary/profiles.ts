// セカンダリー（上場後）の「型」＝ 利確線・損切り線・最長保有・過熱注意の初値倍率 の組み合わせ。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。
//
// 前提（バックテストの手仕舞い規則）: 初値で買い、「初値 + 初日の値幅 × X%」で利確／初値 −Y% で損切り／
// 最長 h 営業日後の終値で手仕舞い。2日目以降は寄付が線を越えていたら寄付で約定、同日に両方届いたら損切りが先。
// 2024〜2026年の167銘柄。どの型も平均は0と区別できない（違うのは勝率と損の形）。

export type SecondaryStyle = "solid" | "standard" | "aggressive" | "custom";

export interface SecondaryProfile {
  style: SecondaryStyle;
  /** 利確線: 初値 + 初日の値幅 × この%（100 = ストップ高） */
  takeProfitPctOfWidth: number;
  /** 損切り線: 初値から −この% */
  stopLossPct: number;
  /** 最長保有（営業日） */
  maxHoldDays: number;
  /** この初値倍率（初値 ÷ 公開価格）を超えたら「中期は不利」の注意を出す */
  overheatRatio: number;
}

/** 型ごとの過去の成績（最長保有後まで含めた1トレードあたりの平均と勝率）。 */
export interface ProfileBacktest {
  meanPct: number;
  winRatePct: number;
  n: number;
}

export type PresetStyle = Exclude<SecondaryStyle, "custom">;

/** 既定の3つの型。 */
export const SECONDARY_PRESETS: Record<PresetStyle, SecondaryProfile> = {
  solid: {
    style: "solid",
    takeProfitPctOfWidth: 50,
    stopLossPct: 10,
    maxHoldDays: 5,
    overheatRatio: 1.5,
  },
  standard: {
    style: "standard",
    takeProfitPctOfWidth: 100,
    stopLossPct: 10,
    maxHoldDays: 20,
    overheatRatio: 1.5,
  },
  aggressive: {
    style: "aggressive",
    takeProfitPctOfWidth: 200,
    stopLossPct: 10,
    maxHoldDays: 60,
    overheatRatio: 2.0,
  },
};

export const DEFAULT_SECONDARY_PROFILE: SecondaryProfile = SECONDARY_PRESETS.standard;

export const SECONDARY_STYLE_LABELS: Record<SecondaryStyle, string> = {
  solid: "堅実",
  standard: "標準",
  aggressive: "攻め",
  custom: "カスタム",
};

/**
 * 既定の型の過去成績。出典: secondary_run.log「C-8. 複数日保有版」（損切り −10%）。
 * 堅実 = 値幅の50%・最長5営業日、標準 = 値幅の100%・最長20営業日、攻め = 値幅の200%・最長60営業日。
 */
export const PRESET_BACKTEST: Record<PresetStyle, ProfileBacktest> = {
  solid: { meanPct: -0.5, winRatePct: 46, n: 159 },
  standard: { meanPct: 1.1, winRatePct: 37, n: 158 },
  aggressive: { meanPct: 2.9, winRatePct: 30, n: 152 },
};

/** 型ごとのひとこと。 */
export const PRESET_NOTES: Record<PresetStyle, string> = {
  solid: "早めに利確して勝率を取りにいく型。1回の勝ちは小さめ。",
  standard: "ストップ高で利確。勝率と値幅のバランス型。",
  aggressive: "大きく伸びる銘柄を待つ型。勝率は低く、損切りが多め。",
};

// --- 到達割合（初値で買った場合に、期間内に線へ届いた割合） ---

/** 期間（営業日）。0 = 上場当日中。 */
export const HIT_RATE_HORIZONS = [0, 5, 20, 60] as const;
export type HitRateHorizon = (typeof HIT_RATE_HORIZONS)[number];

/** 利確線（初値 + 初日の値幅 × X%）の X。 */
export const HIT_RATE_TAKE_PROFIT_PCTS = [25, 50, 100, 200, 300] as const;
/** 損切り線（初値 −Y%）の Y。 */
export const HIT_RATE_STOP_LOSS_PCTS = [5, 10, 20, 30] as const;

export interface HitRateRow {
  /** 利確線 X% → 届いた割合（%） */
  takeProfit: Record<(typeof HIT_RATE_TAKE_PROFIT_PCTS)[number], number>;
  /** 損切り線 −Y% → 届いた割合（%） */
  stopLoss: Record<(typeof HIT_RATE_STOP_LOSS_PCTS)[number], number>;
  n: number;
}

/**
 * 出典: secondary_summary.json の hitProb（2024〜2026年、当日中166件 / 5営業日159件 / 20営業日158件 / 60営業日152件）。
 * 高値・安値が線に届いたかどうか（どちらが先かは問わない）。% は小数1桁で丸めた値。
 */
export const HIT_RATES: Record<HitRateHorizon, HitRateRow> = {
  0: {
    takeProfit: { 25: 53.6, 50: 37.3, 100: 15.7, 200: 0, 300: 0 },
    stopLoss: { 5: 61.4, 10: 31.3, 20: 4.2, 30: 0 },
    n: 166,
  },
  5: {
    takeProfit: { 25: 69.2, 50: 54.1, 100: 34.0, 200: 17.0, 300: 6.3 },
    stopLoss: { 5: 80.5, 10: 66.0, 20: 31.4, 30: 11.3 },
    n: 159,
  },
  20: {
    takeProfit: { 25: 74.1, 50: 61.4, 100: 44.3, 200: 24.7, 300: 10.1 },
    stopLoss: { 5: 86.7, 10: 74.7, 20: 53.8, 30: 28.5 },
    n: 158,
  },
  60: {
    takeProfit: { 25: 80.3, 50: 69.1, 100: 55.3, 200: 34.9, 300: 19.1 },
    stopLoss: { 5: 89.5, 10: 78.3, 20: 67.1, 30: 44.1 },
    n: 152,
  },
};

function nearest<T extends number>(values: readonly T[], target: number): T {
  let best = values[0];
  for (const v of values) {
    if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  }
  return best;
}

export interface HitRateLookup {
  horizon: HitRateHorizon;
  takeProfitPct: number;
  stopLossPct: number;
  /** 利確線に届いた割合（%） */
  takeProfitRate: number;
  /** 損切り線に届いた割合（%） */
  stopLossRate: number;
  /** 表に無い値のため近い列を使ったか */
  takeProfitApprox: boolean;
  stopLossApprox: boolean;
  horizonApprox: boolean;
  n: number;
}

/** プロファイルに最も近い期間・列の到達割合を引く。 */
export function lookupHitRates(profile: SecondaryProfile): HitRateLookup {
  const horizon = nearest(HIT_RATE_HORIZONS, profile.maxHoldDays);
  const tp = nearest(HIT_RATE_TAKE_PROFIT_PCTS, profile.takeProfitPctOfWidth);
  const sl = nearest(HIT_RATE_STOP_LOSS_PCTS, profile.stopLossPct);
  const row = HIT_RATES[horizon];
  return {
    horizon,
    takeProfitPct: tp,
    stopLossPct: sl,
    takeProfitRate: row.takeProfit[tp],
    stopLossRate: row.stopLoss[sl],
    takeProfitApprox: tp !== profile.takeProfitPctOfWidth,
    stopLossApprox: sl !== profile.stopLossPct,
    horizonApprox: horizon !== profile.maxHoldDays,
    n: row.n,
  };
}

/** 期間の表示名。 */
export function horizonLabel(horizon: HitRateHorizon): string {
  return horizon === 0 ? "上場当日中" : `${horizon}営業日以内`;
}

// --- 初値倍率の帯ごとのその後（初値で買い、各時点の終値で評価） ---

export type RatioBand = "le15" | "15to20" | "gt20";

export interface RatioBandStat {
  band: RatioBand;
  label: string;
  /** 当日終値・翌日終値・5営業日後・20営業日後の平均（%）と勝率（%） */
  day0: { meanPct: number; winRatePct: number };
  day1: { meanPct: number; winRatePct: number };
  day5: { meanPct: number; winRatePct: number };
  day20: { meanPct: number; winRatePct: number; n: number };
}

/**
 * 出典: secondary_run.log「B-3. 比較: 現行アプリの初値倍率の帯」（2024〜2026年の167銘柄）。
 * 当日・翌日は帯による差が無く、5営業日以降で 1.5倍超の帯が不利。
 */
export const RATIO_BAND_STATS: Record<RatioBand, RatioBandStat> = {
  le15: {
    band: "le15",
    label: "1.5倍以下",
    day0: { meanPct: 0.1, winRatePct: 41 },
    day1: { meanPct: 1.2, winRatePct: 40 },
    day5: { meanPct: 1.5, winRatePct: 41 },
    day20: { meanPct: 2.5, winRatePct: 42, n: 120 },
  },
  "15to20": {
    band: "15to20",
    label: "1.5〜2.0倍",
    day0: { meanPct: -5.6, winRatePct: 29 },
    day1: { meanPct: -6.9, winRatePct: 22 },
    day5: { meanPct: -5.5, winRatePct: 26 },
    day20: { meanPct: -17.8, winRatePct: 30, n: 23 },
  },
  gt20: {
    band: "gt20",
    label: "2.0倍超",
    day0: { meanPct: 3.9, winRatePct: 59 },
    day1: { meanPct: 5.5, winRatePct: 53 },
    day5: { meanPct: -15.5, winRatePct: 19 },
    day20: { meanPct: -21.1, winRatePct: 12, n: 16 },
  },
};

/** 初値倍率（初値 ÷ 公開価格）の帯。 */
export function ratioBandOf(ratio: number): RatioBand {
  if (ratio <= 1.5) return "le15";
  if (ratio <= 2.0) return "15to20";
  return "gt20";
}

// --- 設定値の範囲と正規化 ---

export const PROFILE_LIMITS = {
  takeProfitPctOfWidth: { min: 10, max: 300, step: 10 },
  stopLossPct: { min: 3, max: 30, step: 1 },
  maxHoldDays: { min: 1, max: 120, step: 1 },
  overheatRatio: { min: 1.2, max: 3.0, step: 0.1 },
} as const;

type LimitKey = keyof typeof PROFILE_LIMITS;

/** 範囲に収め、刻みに丸める（0.1刻みの浮動小数誤差も消す）。 */
export function clampProfileValue(key: LimitKey, value: number): number {
  const { min, max, step } = PROFILE_LIMITS[key];
  const stepped = Math.round(value / step) * step;
  const clamped = Math.min(max, Math.max(min, stepped));
  return Math.round(clamped * 10) / 10;
}

const STYLES = new Set<string>(["solid", "standard", "aggressive", "custom"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 不明な値を SecondaryProfile に正規化する。壊れた値は null（呼び出し側で既定値を使う）。
 * 既定の型（custom 以外）は、保存値に関わらず既定値を返す（既定値を更新したら全員に反映させるため）。
 */
export function normalizeSecondaryProfile(value: unknown): SecondaryProfile | null {
  if (!isRecord(value)) return null;
  const style = typeof value.style === "string" && STYLES.has(value.style)
    ? (value.style as SecondaryStyle)
    : null;
  if (style === null) return null;
  if (style !== "custom") return { ...SECONDARY_PRESETS[style] };
  const num = (key: LimitKey): number => {
    const raw = value[key];
    const fallback = DEFAULT_SECONDARY_PROFILE[key];
    return clampProfileValue(key, typeof raw === "number" && Number.isFinite(raw) ? raw : fallback);
  };
  return {
    style: "custom",
    takeProfitPctOfWidth: num("takeProfitPctOfWidth"),
    stopLossPct: num("stopLossPct"),
    maxHoldDays: num("maxHoldDays"),
    overheatRatio: num("overheatRatio"),
  };
}

/** 符号つきの%表示（+2.5% / −17.8% / 0.0%）。マイナスは全角寄りの記号「−」。 */
export function formatSignedPct(value: number, digits = 1): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return `${value > 0 ? "+" : "−"}${text}%`;
}
