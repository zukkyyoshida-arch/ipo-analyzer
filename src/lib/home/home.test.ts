import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { CompletenessResult } from "@/lib/completeness";
import { computeKpis, upcomingEvents, topPicks } from "./index";

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

const TODAY = "2026-09-25";

describe("computeKpis", () => {
  it("直近90日の listed 銘柄のみを対象にし、全体件数は totalCount に反映する", () => {
    const inWindow = baseIpo({
      code: "A001",
      status: "listed",
      listingDate: "2026-08-01", // today-55日
      offeringPrice: 1000,
      initialPrice: 1500,
    });
    const outOfWindow = baseIpo({
      code: "A002",
      status: "listed",
      listingDate: "2026-01-01", // 90日超前
      offeringPrice: 1000,
      initialPrice: 2000,
    });
    const notListed = baseIpo({ code: "A003", status: "upcoming" });

    const result = computeKpis([inWindow, outOfWindow, notListed], TODAY);

    expect(result.totalCount).toBe(3);
    expect(result.recentListedCount).toBe(1);
    expect(result.avgInitialReturnRate).toBeCloseTo(50, 5);
  });

  it("初値騰落率は (initialPrice/offeringPrice-1)*100 で、どちらかが null の銘柄は平均から除外する", () => {
    const withReturn = baseIpo({
      code: "B001",
      status: "listed",
      listingDate: "2026-09-01",
      offeringPrice: 1000,
      initialPrice: 1200, // +20%
    });
    const missingInitial = baseIpo({
      code: "B002",
      status: "listed",
      listingDate: "2026-09-02",
      offeringPrice: 1000,
      initialPrice: null,
    });

    const result = computeKpis([withReturn, missingInitial], TODAY);

    expect(result.recentListedCount).toBe(2);
    expect(result.avgInitialReturnRate).toBeCloseTo(20, 5);
  });

  it("公募割れ率は initialPrice < offeringPrice の割合（%）", () => {
    const broken = baseIpo({
      code: "C001",
      status: "listed",
      listingDate: "2026-09-01",
      offeringPrice: 1000,
      initialPrice: 900,
    });
    const notBroken = baseIpo({
      code: "C002",
      status: "listed",
      listingDate: "2026-09-02",
      offeringPrice: 1000,
      initialPrice: 1100,
    });

    const result = computeKpis([broken, notBroken], TODAY);

    expect(result.breakEvenRate).toBeCloseTo(50, 5);
  });

  it("対象が0件のとき avgInitialReturnRate・breakEvenRate・topPerformer は null", () => {
    const result = computeKpis([], TODAY);

    expect(result.totalCount).toBe(0);
    expect(result.recentListedCount).toBe(0);
    expect(result.avgInitialReturnRate).toBeNull();
    expect(result.breakEvenRate).toBeNull();
    expect(result.topPerformer).toBeNull();
  });

  it("topPerformer は initialReturnRate が最大の銘柄を採用する", () => {
    const low = baseIpo({
      code: "D001",
      status: "listed",
      listingDate: "2026-09-01",
      offeringPrice: 1000,
      initialPrice: 1100, // +10%
    });
    const high = baseIpo({
      code: "D002",
      status: "listed",
      listingDate: "2026-09-02",
      offeringPrice: 1000,
      initialPrice: 1500, // +50%
    });

    const result = computeKpis([low, high], TODAY);

    expect(result.topPerformer?.ipo.code).toBe("D002");
    expect(result.topPerformer?.metric).toBe("initialReturnRate");
    expect(result.topPerformer?.returnRate).toBeCloseTo(50, 5);
  });

  it("initialReturnRate が無い銘柄は currentPrice/initialPrice の変化率を使う", () => {
    const ipo = baseIpo({
      code: "E001",
      status: "listed",
      listingDate: "2026-09-01",
      offeringPrice: null, // initialReturnRate は計算不能
      initialPrice: 1000,
      currentPrice: 1300, // +30%
    });

    const result = computeKpis([ipo], TODAY);

    expect(result.topPerformer?.ipo.code).toBe("E001");
    expect(result.topPerformer?.metric).toBe("currentVsInitial");
    expect(result.topPerformer?.returnRate).toBeCloseTo(30, 5);
  });
});

describe("upcomingEvents", () => {
  it("bbPeriod.start / allotmentDate / purchasePeriod.start / listingDate のうち期間内のものを日付順に返す", () => {
    const ipo = baseIpo({
      code: "F001",
      bbPeriod: { start: "2026-09-28", end: "2026-10-02" },
      allotmentDate: "2026-10-05",
      purchasePeriod: { start: "2026-10-06", end: "2026-10-08" },
      listingDate: "2026-10-09",
    });

    const events = upcomingEvents([ipo], TODAY, 14);

    expect(events.map((e) => e.kind)).toEqual([
      "bbStart",
      "allotment",
      "purchaseStart",
      "listing",
    ]);
    expect(events.every((e) => e.ipo.code === "F001")).toBe(true);
  });

  it("空文字の日程フィールドは無視する", () => {
    const ipo = baseIpo({
      code: "G001",
      bbPeriod: { start: "", end: "" },
      allotmentDate: "",
      purchasePeriod: { start: "", end: "" },
      listingDate: "2026-09-30",
    });

    const events = upcomingEvents([ipo], TODAY, 14);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("listing");
  });

  it("days 日を超える、または過去のイベントは対象外", () => {
    const tooFar = baseIpo({ code: "H001", listingDate: "2026-10-20" }); // 25日後
    const past = baseIpo({ code: "H002", listingDate: "2026-09-01" }); // 過去

    const events = upcomingEvents([tooFar, past], TODAY, 14);

    expect(events).toHaveLength(0);
  });

  it("today 当日のイベントも含む", () => {
    const ipo = baseIpo({ code: "I001", listingDate: TODAY });

    const events = upcomingEvents([ipo], TODAY, 14);

    expect(events).toHaveLength(1);
  });
});

describe("topPicks", () => {
  const fullCompleteness: CompletenessResult = { level: "full", missing: [] };
  const insufficientCompleteness: CompletenessResult = {
    level: "insufficient",
    missing: ["公開価格", "吸収金額"],
  };

  it("総合スコア降順で上位 n 件を返す", () => {
    const scored = [
      { ipo: baseIpo({ code: "J001" }), overall: 40 },
      { ipo: baseIpo({ code: "J002" }), overall: 80 },
      { ipo: baseIpo({ code: "J003" }), overall: 60 },
    ];

    const result = topPicks(scored, 2, () => fullCompleteness);

    expect(result.map((r) => r.ipo.code)).toEqual(["J002", "J003"]);
  });

  it("completenessFn が insufficient と判定した銘柄はスコア表示せず除外する", () => {
    const scored = [
      { ipo: baseIpo({ code: "K001" }), overall: 90 },
      { ipo: baseIpo({ code: "K002" }), overall: 50 },
    ];

    const result = topPicks(scored, 3, (ipo) =>
      ipo.code === "K001" ? insufficientCompleteness : fullCompleteness,
    );

    expect(result.map((r) => r.ipo.code)).toEqual(["K002"]);
  });

  it("同点は listingDate 昇順", () => {
    const scored = [
      {
        ipo: baseIpo({ code: "L001", listingDate: "2026-09-10" }),
        overall: 70,
      },
      {
        ipo: baseIpo({ code: "L002", listingDate: "2026-09-01" }),
        overall: 70,
      },
    ];

    const result = topPicks(scored, 2, () => fullCompleteness);

    expect(result.map((r) => r.ipo.code)).toEqual(["L002", "L001"]);
  });
});
