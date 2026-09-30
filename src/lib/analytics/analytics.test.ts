import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import {
  periodWindows,
  computeMetrics,
  metricDelta,
  buildSeries,
  listedIn,
  rankByInitialReturn,
} from "./index";

// completeness.test.ts のスタイルに合わせたベース銘柄ビルダー。
function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "2026-07-24",
    bbPeriod: { start: "", end: "" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: 1000,
    priceRangePosition: null,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    absorptionAmount: 20,
    offeringRatio: 20,
    marketCap: 100,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券"],
    financials: {
      revenue: 2000,
      revenueGrowth: 20,
      operatingProfit: 200,
      isProfitable: true,
    },
    per: 30,
    psr: 4,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: null,
    status: "upcoming",
    similarIpoCodes: [],
    ...overrides,
  };
}

const TODAY = "2026-09-28";

describe("periodWindows", () => {
  it("過去 90 日は today を含む 90 日、直前期間は同じ長さで隣接する", () => {
    const { current, previous } = periodWindows("90", TODAY, []);
    expect(current).toEqual({ start: "2026-07-01", end: TODAY });
    expect(previous).toEqual({ start: "2026-04-02", end: "2026-06-30" });
  });

  it("全期間は最古の上場日から始まり、直前期間は無い", () => {
    const ipos = [
      baseIpo({ code: "A", status: "listed", listingDate: "2025-03-10" }),
      baseIpo({ code: "B", status: "upcoming", listingDate: "2024-01-01" }),
    ];
    const { current, previous } = periodWindows("all", TODAY, ipos);
    expect(current.start).toBe("2025-03-10");
    expect(previous).toBeNull();
  });
});

describe("computeMetrics", () => {
  it("データ 0 件なら件数 0・率は null", () => {
    expect(computeMetrics([])).toEqual({
      count: 0,
      avgReturn: null,
      breakRate: null,
      winRate: null,
      sample: 0,
    });
  });

  it("初値未確定の銘柄は件数に含め、率の母数からは除外する", () => {
    const m = computeMetrics([
      baseIpo({ code: "A", status: "listed", initialPrice: 1300 }),
      baseIpo({ code: "B", status: "listed", initialPrice: 900 }),
      baseIpo({ code: "C", status: "listed", initialPrice: null }),
    ]);
    expect(m.count).toBe(3);
    expect(m.sample).toBe(2);
    expect(m.avgReturn).toBeCloseTo(10);
    expect(m.breakRate).toBe(50);
    expect(m.winRate).toBe(50);
  });
});

describe("期間またぎ", () => {
  const ipos = [
    baseIpo({ code: "IN1", status: "listed", listingDate: "2026-07-01", initialPrice: 1200 }),
    baseIpo({ code: "OUT", status: "listed", listingDate: "2026-06-30", initialPrice: 800 }),
    baseIpo({ code: "UP", status: "upcoming", listingDate: "2026-09-01", initialPrice: null }),
  ];

  it("範囲の開始日ちょうどは当期、前日は直前期間に入る", () => {
    const { current, previous } = periodWindows("90", TODAY, ipos);
    expect(listedIn(ipos, current).map((i) => i.code)).toEqual(["IN1"]);
    expect(listedIn(ipos, previous!).map((i) => i.code)).toEqual(["OUT"]);
    const delta = metricDelta(
      computeMetrics(listedIn(ipos, current)),
      computeMetrics(listedIn(ipos, previous!)),
      "avgReturn",
    );
    expect(delta).toBeCloseTo(40);
  });

  it("週次バケットは範囲を漏れなく区切り、最後は today で切り詰める", () => {
    const { current } = periodWindows("90", TODAY, ipos);
    const series = buildSeries(ipos, current, "week");
    expect(series).toHaveLength(13);
    expect(series[0].start).toBe(current.start);
    expect(series[series.length - 1].end).toBe(TODAY);
    expect(series.reduce((s, p) => s + p.metrics.count, 0)).toBe(1);
  });

  it("上場 0 社の期間は件数 0・率と平均は null（グラフでは 0 ではなく値なし）", () => {
    const { current } = periodWindows("90", TODAY, ipos);
    const series = buildSeries(ipos, current, "week");
    const empty = series.filter((p) => p.metrics.count === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const p of empty) {
      expect(p.metrics.count).toBe(0);
      expect(p.metrics.avgReturn).toBeNull();
      expect(p.metrics.winRate).toBeNull();
      expect(p.metrics.breakRate).toBeNull();
    }
    const filled = series.find((p) => p.metrics.count > 0);
    expect(filled?.metrics.avgReturn).toBeCloseTo(20);
  });

  it("月次バケットは暦月で区切る", () => {
    const series = buildSeries(ipos, { start: "2026-06-15", end: TODAY }, "month");
    expect(series.map((p) => p.start)).toEqual([
      "2026-06-15",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(series[0].metrics.count).toBe(1);
  });

  it("初値騰落率ランキングは初値未確定を除外する", () => {
    const withNull = [
      ...ipos,
      baseIpo({ code: "N", status: "listed", listingDate: "2026-08-01", initialPrice: null }),
    ];
    const { current } = periodWindows("90", TODAY, withNull);
    expect(rankByInitialReturn(withNull, current).map((r) => r.ipo.code)).toEqual(["IN1"]);
  });
});
