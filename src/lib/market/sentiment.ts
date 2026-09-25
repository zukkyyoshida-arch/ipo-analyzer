import type { Sentiment } from "@/types/ipo";
import type { MarketIndicators, TrendDirection } from "@/types/data";

// 地合い（sentiment）の自動判定を行う純関数群。テスト対象。
//
// 3つの指標をルールベースでスコア化し合成する:
//   1. 日経平均トレンド（現在値 vs 25日移動平均）
//   2. グロース250 ETF(2516.T) トレンド（同上）
//   3. 直近上場銘柄の初値騰落率の平均
// それぞれを -1〜+1 に写像して合算し、閾値で strong / neutral / weak を決める。
//
// 閾値の根拠はコード内コメントに明記する。IPO初値は「地合い（マザーズ/グロースの
// リスク選好）」に強く連動するため、指数トレンドと直近初値実績の両面から見る。

/**
 * 現在値と移動平均から騰落トレンドを判定する。
 * 乖離が ±0.5% 未満なら flat（横ばい）とみなす。
 * 0.5% は日次のノイズを均し、方向感が出たときだけ up/down とするための閾値。
 */
export const TREND_FLAT_THRESHOLD = 0.005;

export function classifyTrend(
  current: number,
  movingAverage: number,
): TrendDirection {
  if (movingAverage <= 0 || !Number.isFinite(current)) return "flat";
  const deviation = (current - movingAverage) / movingAverage;
  if (deviation > TREND_FLAT_THRESHOLD) return "up";
  if (deviation < -TREND_FLAT_THRESHOLD) return "down";
  return "flat";
}

/** 終値配列から末尾 n 本の単純移動平均を求める。データ不足時は取れる範囲で平均。 */
export function movingAverage(closes: number[], period: number): number | null {
  const valid = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (valid.length === 0) return null;
  const slice = valid.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

/** トレンドを -1（down）/ 0（flat）/ +1（up）のスコアに写像。 */
function trendScore(t: TrendDirection): number {
  if (t === "up") return 1;
  if (t === "down") return -1;
  return 0;
}

/**
 * 直近上場の初値騰落率平均を -1〜+1 のスコアに写像。
 * 根拠: 初値がおおむね公開価格を上回る（+）と地合いは良好、
 * 割れ気味（-）だと軟調と判断する。
 * - 平均 +30% 以上: +1（初値高騰が続く強い需給）
 * - 平均 +10% 以上: +0.5
 * - 平均 -5% 超〜+10%未満: 0（可もなく不可もなく）
 * - 平均 -5% 以下: -1（公募割れが目立つ軟調地合い）
 * データが無ければ 0（中立扱い）。
 */
export const IPO_STRONG_RETURN = 30;
export const IPO_MILD_RETURN = 10;
export const IPO_WEAK_RETURN = -5;

function ipoReturnScore(avgReturn: number | null): number {
  if (avgReturn === null) return 0;
  if (avgReturn >= IPO_STRONG_RETURN) return 1;
  if (avgReturn >= IPO_MILD_RETURN) return 0.5;
  if (avgReturn <= IPO_WEAK_RETURN) return -1;
  return 0;
}

/**
 * 3指標の合成スコア（-3〜+3 相当）から地合いを決める閾値。
 * - 合計 +1.5 以上: strong（指数と初値の両方が明確に上向き）
 * - 合計 -1.5 以下: weak（両方が明確に下向き）
 * - それ以外: neutral
 * 1.5 は「3指標中2つ以上が明確にプラス（またはマイナス）」を要求する水準。
 * 指数2本のトレンドだけ（最大+2）では strong に届かず、初値実績の後押しが要る設計。
 */
export const SENTIMENT_STRONG_THRESHOLD = 1.5;
export const SENTIMENT_WEAK_THRESHOLD = -1.5;

export function judgeSentiment(indicators: MarketIndicators): Sentiment {
  const total =
    trendScore(indicators.nikkeiTrend) +
    trendScore(indicators.growth250Trend) +
    ipoReturnScore(indicators.recentIpoAvgReturn);

  if (total >= SENTIMENT_STRONG_THRESHOLD) return "strong";
  if (total <= SENTIMENT_WEAK_THRESHOLD) return "weak";
  return "neutral";
}

export interface BuildIndicatorsInput {
  nikkeiCloses: number[];
  growth250Closes: number[];
  recentIpoReturns: number[];
}

/** 生の終値・初値騰落率配列から MarketIndicators を組み立てる（25日移動平均を使用）。 */
export function buildIndicators(input: BuildIndicatorsInput): MarketIndicators {
  const nikkeiMa = movingAverage(input.nikkeiCloses, 25);
  const growthMa = movingAverage(input.growth250Closes, 25);
  const nikkeiCurrent = lastValid(input.nikkeiCloses);
  const growthCurrent = lastValid(input.growth250Closes);

  const validReturns = input.recentIpoReturns.filter((r) => Number.isFinite(r));
  const recentIpoAvgReturn =
    validReturns.length > 0
      ? validReturns.reduce((a, b) => a + b, 0) / validReturns.length
      : null;

  return {
    nikkeiTrend:
      nikkeiCurrent !== null && nikkeiMa !== null
        ? classifyTrend(nikkeiCurrent, nikkeiMa)
        : "flat",
    growth250Trend:
      growthCurrent !== null && growthMa !== null
        ? classifyTrend(growthCurrent, growthMa)
        : "flat",
    recentIpoAvgReturn,
  };
}

function lastValid(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i]) && values[i] > 0) return values[i];
  }
  return null;
}
