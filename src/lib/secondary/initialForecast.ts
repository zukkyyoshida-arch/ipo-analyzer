// 予想初値（上場前の情報だけで初値倍率を推定するリッジ回帰）。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。
//
// Python（scratch/backtest/secondary_backtest.py の build_features と Ridge.predict）の忠実な移植。
// 目的変数は log(初値 / 公開価格)。予想 = intercept + Σ w·(x − mean) / sd（欠損は学習データの中央値で補完）。
// 学習 2015〜2023年の821件、検証 2024〜2026年の170件（MAE 0.193 log、80%レンジ的中 89%）。
// 日経平均の25日線乖離（nk_dev）はアプリでは取れないため常に欠損（中央値で補完）。

import type { Ipo } from "@/types/ipo";
import type { IpoEnriched } from "@/types/enriched";
import type { HistoricalIpo } from "@/types/history";
import { saleRatioOf } from "@/lib/scoring/bb";
import model from "./initialForecastModel.json";

export type FeatureKey =
  | "log_abs"
  | "log_abs_big"
  | "log_mcap"
  | "growth"
  | "prime"
  | "sale_ratio"
  | "vc"
  | "vc_na"
  | "top"
  | "range_width"
  | "chg"
  | "log_offer"
  | "same_day"
  | "recent5"
  | "recent20"
  | "nk_dev"
  | "dec"
  | "mar"
  | "uw_count"
  | "profit"
  | "profit_na";

type Params = Record<FeatureKey, number>;

const FEATURES = model.features as FeatureKey[];
const COEF = model.coef_std as Params;
const MEAN = model.feature_mean as Params;
const SD = model.feature_sd as Params;
const MEDIAN = model.impute_median as Params;
const Q = model.residual_quantiles;

/** 欠損を数える元の入力（派生・欠損フラグ・常に欠損の nk_dev は数えない）と表示名。 */
const COUNTED_INPUTS: readonly [FeatureKey, string][] = [
  ["log_abs", "吸収金額"],
  ["log_mcap", "時価総額"],
  ["sale_ratio", "売出比率"],
  ["vc", "VC比率"],
  ["top", "仮条件の上限で決定か"],
  ["range_width", "仮条件の幅"],
  ["chg", "想定価格→公開価格"],
  ["same_day", "同日上場数"],
  ["recent5", "直近5件の初値"],
  ["recent20", "直近20件の初値"],
  ["dec", "上場月"],
  ["uw_count", "幹事団社数"],
  ["profit", "黒字か"],
];

const RECENT_SHORT = 5;
const RECENT_LONG = 20;

/** 直近の初値騰落の計算に使う過去銘柄（上場日・公開価格・初値）。 */
export interface RecentPoolEntry {
  code: string;
  listingDate: string;
  offeringPrice: number | null;
  initialPrice: number | null;
}

/** 特徴量（生の値。欠損は NaN）。 */
export type ForecastFeatures = Record<FeatureKey, number>;

export interface InitialForecast {
  /** 予想初値の中心（円・上場時の単位） */
  centerPrice: number;
  /** 50%レンジ（残差の25〜75%分位） */
  range50: { low: number; high: number };
  /** 80%レンジ（残差の10〜90%分位） */
  range80: { low: number; high: number };
  /** 予想初値 ÷ 公開価格 */
  ratioToOffering: number;
  /** 予想の log(初値/公開価格) */
  predLog: number;
  /** 欠損した入力の数（nk_dev・派生項目は数えない） */
  missingCount: number;
  /** 欠損した入力の表示名 */
  missingFeatures: string[];
  /** 学習件数 */
  sampleCount: number;
  /** 2024年以降の検証成績 */
  validation: {
    n: number;
    maeLog: number;
    maeReturnPt: number;
    cover50: number;
    cover80: number;
  };
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * allIpos（2024年以降）と履歴（2015〜2023年）を合わせた、直近の初値騰落計算用の母集団。
 * 同じ銘柄コード×上場日は allIpos を優先する。
 */
export function buildRecentPool(
  allIpos: readonly Pick<Ipo, "code" | "listingDate" | "offeringPrice" | "initialPrice">[],
  history: readonly Pick<HistoricalIpo, "code" | "listingDate" | "offeringPrice" | "initialPrice">[],
): RecentPoolEntry[] {
  const byKey = new Map<string, RecentPoolEntry>();
  for (const h of history) {
    byKey.set(`${h.code}:${h.listingDate}`, {
      code: h.code,
      listingDate: h.listingDate,
      offeringPrice: h.offeringPrice,
      initialPrice: h.initialPrice,
    });
  }
  for (const i of allIpos) {
    byKey.set(`${i.code}:${i.listingDate}`, {
      code: i.code,
      listingDate: i.listingDate,
      offeringPrice: i.offeringPrice,
      initialPrice: i.initialPrice,
    });
  }
  return Array.from(byKey.values());
}

/**
 * 上場日より前に上場した直近 n 件の log(初値/公開価格) の平均。上場日当日の銘柄は含めない。
 * n 件に満たなければ null。
 */
export function recentLogReturnBefore(
  pool: readonly RecentPoolEntry[],
  listingDate: string,
  n: number,
): number | null {
  if (!listingDate) return null;
  const prior = pool
    .filter(
      (o) =>
        o.listingDate !== "" &&
        o.listingDate < listingDate &&
        positive(o.offeringPrice) &&
        positive(o.initialPrice),
    )
    .sort((a, b) =>
      a.listingDate === b.listingDate
        ? a.code.localeCompare(b.code)
        : a.listingDate.localeCompare(b.listingDate),
    )
    .slice(-n);
  if (prior.length < n) return null;
  const sum = prior.reduce(
    (acc, o) => acc + Math.log((o.initialPrice as number) / (o.offeringPrice as number)),
    0,
  );
  return sum / prior.length;
}

/** 黒字か（1/0）。enriched の業績 → Ipo の業績（未取得の既定値でなければ）の順。判定できなければ NaN。 */
function profitOf(ipo: Ipo, enriched?: Pick<IpoEnriched, "financials">): number {
  const e = enriched?.financials;
  if (e && typeof e.isProfitable === "boolean") return e.isProfitable ? 1 : 0;
  const f = ipo.financials;
  const isPlaceholder =
    f.revenue === 0 && f.operatingProfit === 0 && f.revenueGrowth === 0;
  if (!isPlaceholder && typeof f.isProfitable === "boolean") return f.isProfitable ? 1 : 0;
  return NaN;
}

/** VC比率（%）。enriched に数値があればそれ（0 も有効）、無ければ Ipo の値（0 は未取得とみなす）。 */
function vcPctOf(ipo: Ipo, enriched?: Pick<IpoEnriched, "vcRatio">): number {
  if (typeof enriched?.vcRatio === "number" && Number.isFinite(enriched.vcRatio)) {
    return enriched.vcRatio;
  }
  return positive(ipo.vcRatio) ? ipo.vcRatio : NaN;
}

/** 上場月（1〜12）。上場日が未定なら NaN。 */
function listingMonth(listingDate: string): number {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(listingDate);
  return m ? Number(m[1]) : NaN;
}

/** Python の build_features と同じ特徴量を作る（欠損は NaN）。公開価格が無ければ null。 */
export function buildForecastFeatures(
  ipo: Ipo,
  pool: readonly RecentPoolEntry[],
  enriched?: Pick<IpoEnriched, "vcRatio" | "financials">,
): ForecastFeatures | null {
  const offer = ipo.offeringPrice;
  if (!positive(offer)) return null;

  const logAbs = positive(ipo.absorptionAmount) ? Math.log(ipo.absorptionAmount) : NaN;
  // np.maximum(NaN - c, 0) は NaN なので、吸収金額が欠損なら折れ項も欠損。
  const logAbsBig = Number.isFinite(logAbs)
    ? Math.max(logAbs - Math.log(model.abs_knot_oku), 0)
    : NaN;
  const saleRatio = saleRatioOf(ipo);
  const vcPct = vcPctOf(ipo, enriched);
  const { low, high } = ipo.priceRange;
  const month = listingMonth(ipo.listingDate);
  const profit = profitOf(ipo, enriched);
  const recent5 = recentLogReturnBefore(pool, ipo.listingDate, RECENT_SHORT);
  const recent20 = recentLogReturnBefore(pool, ipo.listingDate, RECENT_LONG);

  return {
    log_abs: logAbs,
    log_abs_big: logAbsBig,
    log_mcap: positive(ipo.marketCap) ? Math.log(ipo.marketCap) : NaN,
    growth: ipo.market === "グロース" ? 1 : 0,
    prime: ipo.market === "プライム" ? 1 : 0,
    sale_ratio: saleRatio === null ? NaN : saleRatio / 100,
    vc: Number.isFinite(vcPct) ? vcPct / 100 : NaN,
    vc_na: Number.isFinite(vcPct) ? 0 : 1,
    top: positive(high) ? (offer >= high - 1e-9 ? 1 : 0) : NaN,
    range_width: positive(low) && positive(high) ? high / low - 1 : NaN,
    chg: positive(ipo.assumedPrice) ? Math.log(offer / ipo.assumedPrice) : NaN,
    log_offer: Math.log(offer),
    same_day: positive(ipo.sameDayListings) ? ipo.sameDayListings : NaN,
    recent5: recent5 ?? NaN,
    recent20: recent20 ?? NaN,
    nk_dev: NaN,
    dec: Number.isFinite(month) ? (month === 12 ? 1 : 0) : NaN,
    mar: Number.isFinite(month) ? (month === 3 ? 1 : 0) : NaN,
    uw_count: ipo.underwriters.length > 0 ? ipo.underwriters.length : NaN,
    profit,
    profit_na: Number.isFinite(profit) ? 0 : 1,
  };
}

/** Ridge.predict: 欠損を中央値で埋め → (x − mean) / sd → intercept + Σ w·z。 */
export function predictLogRatio(features: ForecastFeatures): number {
  let y = model.intercept;
  for (const key of FEATURES) {
    const raw = features[key];
    const x = Number.isFinite(raw) ? raw : MEDIAN[key];
    const z = (x - MEAN[key]) / SD[key];
    y += COEF[key] * z;
  }
  return y;
}

/**
 * 予想初値。公開価格が無ければ null。
 * @param ipo 対象銘柄（公開価格・初値は上場時の単位）
 * @param pool 直近の初値騰落の母集団（buildRecentPool）
 * @param enriched 補完データ（VC比率・業績の判定に使う。任意）
 */
export function forecastInitialPrice(
  ipo: Ipo,
  pool: readonly RecentPoolEntry[],
  enriched?: Pick<IpoEnriched, "vcRatio" | "financials">,
): InitialForecast | null {
  const features = buildForecastFeatures(ipo, pool, enriched);
  if (features === null || ipo.offeringPrice === null) return null;
  const offer = ipo.offeringPrice;
  const pred = predictLogRatio(features);
  const at = (q: number) => Math.round(offer * Math.exp(pred + q));
  const missingFeatures = COUNTED_INPUTS.filter(([key]) => !Number.isFinite(features[key])).map(
    ([, label]) => label,
  );
  const t = model.metrics_test;
  return {
    centerPrice: Math.round(offer * Math.exp(pred)),
    range50: { low: at(Q.q25), high: at(Q.q75) },
    range80: { low: at(Q.q10), high: at(Q.q90) },
    ratioToOffering: Math.exp(pred),
    predLog: pred,
    missingCount: missingFeatures.length,
    missingFeatures,
    sampleCount: model.n_train,
    validation: {
      n: t.n,
      maeLog: t.mae_log,
      maeReturnPt: t.mae_ret_pt,
      cover50: t.cover50,
      cover80: t.cover80,
    },
  };
}

/** 表示してよい予想か（吸収金額があり、欠損が3項目以下）。 */
export function isForecastUsable(forecast: InitialForecast | null): forecast is InitialForecast {
  return (
    forecast !== null &&
    forecast.missingCount <= 3 &&
    !forecast.missingFeatures.includes("吸収金額")
  );
}

/** 到達率 = 初値 ÷ 予想中心。どちらかが無ければ null。 */
export function reachRatio(
  initialPrice: number | null | undefined,
  centerPrice: number | null | undefined,
): number | null {
  if (!positive(initialPrice) || !positive(centerPrice)) return null;
  return initialPrice / centerPrice;
}
