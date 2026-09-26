import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import { assessCompleteness } from "./completeness";

// テスト用のベース銘柄。scoring/scoring.test.ts のスタイルに合わせる。
function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "2026-07-24",
    bbPeriod: { start: "2026-07-07", end: "2026-07-11" },
    allotmentDate: "2026-07-15",
    purchasePeriod: { start: "2026-07-16", end: "2026-07-22" },
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

describe("assessCompleteness", () => {
  it("公開価格・吸収金額とも無ければ insufficient", () => {
    const ipo = baseIpo({ offeringPrice: null, absorptionAmount: 0 });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("insufficient");
    expect(result.missing).toEqual(["公開価格", "吸収金額"]);
  });

  it("主要項目が揃っていれば full", () => {
    const ipo = baseIpo();
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("full");
    expect(result.missing).toEqual([]);
  });

  it("公開価格はあるが BB日程が未取得なら partial", () => {
    const ipo = baseIpo({ bbPeriod: { start: "", end: "" } });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("partial");
    expect(result.missing).toEqual(["BB日程"]);
  });

  it("公開価格はあるが売上成長率が既定値(0)なら partial", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 2000,
        revenueGrowth: 0,
        operatingProfit: 200,
        isProfitable: true,
      },
    });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("partial");
    expect(result.missing).toEqual(["売上成長率"]);
  });

  it("公開価格はあるが VC比率が既定値(0)なら partial", () => {
    const ipo = baseIpo({ vcRatio: 0 });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("partial");
    expect(result.missing).toEqual(["VC比率"]);
  });

  it("公開価格はあるが吸収金額が0なら partial（insufficientにはならない）", () => {
    const ipo = baseIpo({ absorptionAmount: 0 });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("partial");
    expect(result.missing).toEqual(["吸収金額"]);
  });

  it("複数項目が未取得なら missing に複数入る", () => {
    const ipo = baseIpo({
      bbPeriod: { start: "", end: "" },
      vcRatio: 0,
    });
    const result = assessCompleteness(ipo);
    expect(result.level).toBe("partial");
    expect(result.missing).toEqual(["BB日程", "VC比率"]);
  });
});
