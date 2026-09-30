import { describe, expect, it } from "vitest";
import type { Ipo } from "@/types/ipo";
import {
  buildForecastFeatures,
  buildRecentPool,
  forecastInitialPrice,
  isForecastUsable,
  predictLogRatio,
  reachRatio,
  recentLogReturnBefore,
  type RecentPoolEntry,
} from "./initialForecast";
import model from "./initialForecastModel.json";

function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: [],
    description: "",
    listingDate: "2026-03-10",
    bbPeriod: { start: "", end: "" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
    assumedPrice: 1050,
    priceRange: { low: 1000, high: 1100 },
    offeringPrice: 1100,
    priceRangePosition: "upper",
    publicShares: 600000,
    saleShares: 400000,
    overAllotment: 150000,
    absorptionAmount: 12.5,
    offeringRatio: 20,
    marketCap: 80,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
    leadUnderwriter: "A",
    underwriters: ["A", "B", "C", "D", "E", "F", "G", "H"],
    financials: { revenue: 2000, revenueGrowth: 20, operatingProfit: 200, isProfitable: true },
    per: null,
    psr: null,
    sameDayListings: 2,
    sameWeekListings: 3,
    initialPrice: null,
    status: "priced",
    similarIpoCodes: [],
    ...overrides,
  };
}

describe("モデル定数", () => {
  it("secondary_model.json の値をそのまま写している", () => {
    expect(model.intercept).toBe(0.4873);
    expect(model.abs_knot_oku).toBe(50);
    expect(model.n_train).toBe(821);
    expect(model.coef_std.log_abs).toBe(-0.50407);
    expect(model.residual_quantiles.q90).toBe(0.38951);
    expect(model.metrics_test.cover80).toBe(0.89412);
  });
});

describe("forecastInitialPrice", () => {
  it("既知例: Python（同じ係数で計算）と一致する", () => {
    // Python: intercept + Σ coef·(x − mean)/sd、欠損は impute_median。recent5/20・nk_dev は欠損。
    const f = forecastInitialPrice(baseIpo(), []);
    expect(f).not.toBeNull();
    expect(f!.predLog).toBeCloseTo(0.6174560701665764, 10);
    expect(f!.centerPrice).toBe(2040);
    expect(f!.range80).toEqual({ low: 1376, high: 3011 });
    expect(f!.ratioToOffering).toBeCloseTo(Math.exp(0.6174560701665764), 10);
    expect(f!.missingFeatures).toEqual(["直近5件の初値", "直近20件の初値"]);
    expect(f!.missingCount).toBe(2);
    expect(f!.sampleCount).toBe(821);
    expect(f!.validation.cover80).toBe(0.89412);
    expect(f!.range50.low).toBeLessThan(f!.centerPrice);
    expect(f!.range50.high).toBeGreaterThan(f!.centerPrice);
  });

  it("公開価格が無ければ null", () => {
    expect(forecastInitialPrice(baseIpo({ offeringPrice: null }), [])).toBeNull();
  });

  it("特徴量: Python の build_features と同じ定義", () => {
    const x = buildForecastFeatures(baseIpo(), [])!;
    expect(x.log_abs).toBeCloseTo(Math.log(12.5), 12);
    expect(x.log_abs_big).toBe(0);
    expect(x.sale_ratio).toBeCloseTo(0.4, 12);
    expect(x.vc).toBeCloseTo(0.2, 12);
    expect(x.vc_na).toBe(0);
    expect(x.top).toBe(1);
    expect(x.range_width).toBeCloseTo(0.1, 12);
    expect(x.chg).toBeCloseTo(Math.log(1100 / 1050), 12);
    expect(x.mar).toBe(1);
    expect(x.dec).toBe(0);
    expect(x.uw_count).toBe(8);
    expect(x.profit).toBe(1);
    expect(Number.isNaN(x.nk_dev)).toBe(true);
  });

  it("大型（吸収金額が折れ点50億円超）は折れ項が正", () => {
    const x = buildForecastFeatures(baseIpo({ absorptionAmount: 200 }), [])!;
    expect(x.log_abs_big).toBeCloseTo(Math.log(200) - Math.log(50), 12);
  });

  it("未取得の既定値（0）は欠損として中央値で補完し、フラグを立てる", () => {
    const x = buildForecastFeatures(
      baseIpo({
        absorptionAmount: 0,
        vcRatio: 0,
        financials: { revenue: 0, revenueGrowth: 0, operatingProfit: 0, isProfitable: false },
        underwriters: [],
      }),
      [],
    )!;
    expect(Number.isNaN(x.log_abs)).toBe(true);
    expect(Number.isNaN(x.log_abs_big)).toBe(true);
    expect(x.vc_na).toBe(1);
    expect(x.profit_na).toBe(1);
    expect(Number.isNaN(x.uw_count)).toBe(true);
    // 欠損は impute_median と同じ扱い
    const filled = { ...x, log_abs: model.impute_median.log_abs };
    expect(predictLogRatio(x)).toBeCloseTo(predictLogRatio(filled), 12);
  });

  it("enriched の VC比率 0 は実値として使う", () => {
    const x = buildForecastFeatures(baseIpo({ vcRatio: 0 }), [], { vcRatio: 0 })!;
    expect(x.vc).toBe(0);
    expect(x.vc_na).toBe(0);
  });

  it("欠損が多い・吸収金額が無い予想は表示しない", () => {
    expect(isForecastUsable(forecastInitialPrice(baseIpo(), []))).toBe(true);
    expect(isForecastUsable(forecastInitialPrice(baseIpo({ absorptionAmount: 0 }), []))).toBe(
      false,
    );
    expect(
      isForecastUsable(
        forecastInitialPrice(
          baseIpo({ marketCap: 0, underwriters: [], assumedPrice: 0 }),
          [],
        ),
      ),
    ).toBe(false);
    expect(isForecastUsable(null)).toBe(false);
  });
});

describe("recentLogReturnBefore / buildRecentPool", () => {
  const pool: RecentPoolEntry[] = Array.from({ length: 6 }, (_, i) => ({
    code: `C${i}`,
    listingDate: `2026-01-0${i + 1}`,
    offeringPrice: 1000,
    initialPrice: 1000 * Math.exp(0.1 * (i + 1)),
  }));

  it("上場日より前の直近 n 件の log 平均（当日は含めない）", () => {
    // 2026-01-06 より前 = i=0..4 → log は 0.1〜0.5、平均 0.3
    expect(recentLogReturnBefore(pool, "2026-01-06", 5)).toBeCloseTo(0.3, 12);
    // 2026-01-07 より前の直近5件 = i=1..5 → 0.2〜0.6、平均 0.4
    expect(recentLogReturnBefore(pool, "2026-01-07", 5)).toBeCloseTo(0.4, 12);
  });
  it("件数が足りなければ null", () => {
    expect(recentLogReturnBefore(pool, "2026-01-03", 5)).toBeNull();
    expect(recentLogReturnBefore(pool, "2026-01-07", 20)).toBeNull();
  });
  it("履歴と現行データを合わせ、同じ銘柄×上場日は現行を優先", () => {
    const merged = buildRecentPool(
      [{ code: "A", listingDate: "2024-01-01", offeringPrice: 100, initialPrice: 200 }],
      [
        { code: "A", listingDate: "2024-01-01", offeringPrice: 100, initialPrice: 150 },
        { code: "B", listingDate: "2020-01-01", offeringPrice: 100, initialPrice: null },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.code === "A")?.initialPrice).toBe(200);
  });
});

describe("reachRatio", () => {
  it("初値 ÷ 予想中心", () => {
    expect(reachRatio(2240, 2000)).toBeCloseTo(1.12, 12);
  });
  it("どちらかが無ければ null", () => {
    expect(reachRatio(null, 2000)).toBeNull();
    expect(reachRatio(2000, 0)).toBeNull();
  });
});
