import type { Ipo } from "@/types/ipo";
import type { IpoEnriched } from "@/types/enriched";
import {
  forecastInitialPrice,
  isForecastUsable,
  type RecentPoolEntry,
} from "@/lib/secondary/initialForecast";

// 即金規制（即日現金預託規制）の可能性。初日に気配の上限（公開価格の 2.3 倍）で初値が付かないと、
// 2 日目から現金・指値のみになる。上場前は予想初値の倍率で、上場後は初値が付いたかどうかで判定する。

export type InstantCashStatus = "likely" | "active" | null;

/**
 * @param forecastRatio 予想初値 ÷ 公開価格（無ければ null）
 * @param ipo 対象銘柄
 * @param dayN 上場 N 日目（上場日 = 1。上場前は null）
 * @param thresholdRatio 可能性ありとみなす倍率
 */
export function instantCashStatus(
  forecastRatio: number | null,
  ipo: Pick<Ipo, "initialPrice" | "initialVolume">,
  dayN: number | null,
  thresholdRatio: number,
): InstantCashStatus {
  const hasInitial = typeof ipo.initialPrice === "number" && ipo.initialPrice > 0;
  if (dayN !== null && dayN >= 2 && !hasInitial) {
    const vol = ipo.initialVolume;
    if (vol === null || vol === undefined || vol === 0) return "active";
  }
  if (hasInitial) return null;
  if (forecastRatio !== null && forecastRatio >= thresholdRatio) return "likely";
  return null;
}

export const INSTANT_CASH_LABEL: Record<Exclude<InstantCashStatus, null>, string> = {
  likely: "即金規制の可能性",
  active: "即金規制中",
};

/**
 * BB 期間の銘柄の予想倍率。公開価格が未定なら仮条件の上限（無ければ想定価格）で決まったとみなして予想する。
 * 予想が使えない（欠損が多い）ときは null。
 */
export function bbForecastRatio(
  ipo: Ipo,
  pool: readonly RecentPoolEntry[],
  enriched?: Pick<IpoEnriched, "vcRatio" | "financials">,
): number | null {
  const offer =
    ipo.offeringPrice ?? (ipo.priceRange.high > 0 ? ipo.priceRange.high : ipo.assumedPrice > 0 ? ipo.assumedPrice : null);
  if (offer === null) return null;
  const forecast = forecastInitialPrice({ ...ipo, offeringPrice: offer }, pool, enriched);
  return isForecastUsable(forecast) ? forecast.ratioToOffering : null;
}
