// 東証の制限値幅（ストップ高・ストップ安）と呼値の単位（純関数）。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。
//
// - 基準値段: 上場初日は初値、2日目以降は前日終値。
// - ストップ高 = 基準値段 + 制限値幅。呼値の刻みに乗らないとき（2,501円 + 500円 = 3,001円 は
//   5円刻みの帯）は呼値に切り上げる（価格データで確認した挙動: 3,001→3,005、5,195→5,200）。
// - 初値が付く前の気配の上限は公開価格の2.3倍。
// 表はバックテスト（scratch/backtest/secondary_backtest.py の LIMIT_TABLE・TICK_TABLE）と同じ。

/** 制限値幅の表。基準値段が「上限未満」→ 値幅。 */
const LIMIT_TABLE: readonly (readonly [number, number])[] = [
  [100, 30],
  [200, 50],
  [500, 80],
  [700, 100],
  [1_000, 150],
  [1_500, 300],
  [2_000, 400],
  [3_000, 500],
  [5_000, 700],
  [7_000, 1_000],
  [10_000, 1_500],
  [15_000, 3_000],
  [20_000, 4_000],
  [30_000, 5_000],
  [50_000, 7_000],
  [70_000, 10_000],
  [100_000, 15_000],
  [150_000, 30_000],
  [200_000, 40_000],
  [300_000, 50_000],
  [500_000, 70_000],
  [700_000, 100_000],
  [1_000_000, 150_000],
  [1_500_000, 300_000],
  [2_000_000, 400_000],
  [3_000_000, 500_000],
  [5_000_000, 700_000],
  [7_000_000, 1_000_000],
  [10_000_000, 1_500_000],
];

/** 呼値の単位（TOPIX500 以外）。価格が「上限以下」→ 呼値。 */
const TICK_TABLE: readonly (readonly [number, number])[] = [
  [3_000, 1],
  [5_000, 5],
  [30_000, 10],
  [50_000, 50],
  [300_000, 100],
  [500_000, 500],
  [3_000_000, 1_000],
  [5_000_000, 5_000],
  [30_000_000, 10_000],
  [50_000_000, 50_000],
];

/** 初値が付く前の気配の上限（公開価格に対する倍率）。 */
export const PRE_OPEN_UPPER_MULTIPLE = 2.3;

/** 制限値幅（円）。基準値段が表の範囲外なら最後の行の値幅を使う。 */
export function limitWidth(base: number): number {
  for (const [upper, width] of LIMIT_TABLE) {
    if (base < upper) return width;
  }
  return LIMIT_TABLE[LIMIT_TABLE.length - 1][1];
}

/** 呼値の単位（円）。 */
export function tickSize(price: number): number {
  for (const [upper, tick] of TICK_TABLE) {
    if (price <= upper) return tick;
  }
  return 100_000;
}

/** 呼値に切り上げる（浮動小数の誤差を避けるため 1e-6 で丸めてから）。 */
export function ceilTick(price: number): number {
  const t = tickSize(price);
  return Math.ceil(round6(price / t)) * t;
}

/** 呼値に切り下げる。 */
export function floorTick(price: number): number {
  const t = tickSize(price);
  return Math.floor(round6(price / t)) * t;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** ストップ高（基準値段 + 制限値幅 を呼値に切り上げ）。 */
export function stopHigh(base: number): number {
  return ceilTick(base + limitWidth(base));
}

/** ストップ安（基準値段 − 制限値幅。呼値に乗らなければ売買できる値に切り上げ）。 */
export function stopLow(base: number): number {
  return Math.max(ceilTick(base - limitWidth(base)), 1);
}

/** 基準値段 + 値幅 × pct%（利確線など）。呼値に切り上げ。 */
export function lineAbove(base: number, pctOfWidth: number): number {
  return ceilTick(base + (limitWidth(base) * pctOfWidth) / 100);
}

/** 基準値段 × (1 − pct%)（損切り線など）。呼値に切り下げ。 */
export function lineBelow(base: number, pct: number): number {
  return floorTick(base * (1 - pct / 100));
}

/** 初値が付く前の気配の上限（公開価格 × 2.3 を呼値に切り下げ）。 */
export function preOpenUpperLimit(offeringPrice: number): number {
  return floorTick(offeringPrice * PRE_OPEN_UPPER_MULTIPLE);
}
