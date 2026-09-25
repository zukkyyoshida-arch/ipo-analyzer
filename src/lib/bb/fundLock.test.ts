import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { BbState } from "@/types/userData";
import {
  buildFundLockPeriods,
  groupOverlappingLocks,
  periodsOverlap,
  type FundLockPeriod,
} from "./fundLock";

function ipo(code: string, overrides: Partial<Ipo> = {}): Ipo {
  return {
    code,
    name: `銘柄${code}`,
    market: "グロース",
    sector: "",
    theme: [],
    description: "",
    listingDate: "2026-10-20",
    bbPeriod: { start: "2026-10-01", end: "2026-10-07" },
    allotmentDate: "2026-10-08",
    purchasePeriod: { start: "2026-10-09", end: "2026-10-15" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 0,
    saleShares: 0,
    overAllotment: 0,
    absorptionAmount: 10,
    offeringRatio: 20,
    marketCap: 50,
    vcRatio: 0,
    lockup: { days: 90, hasPriceRelease: true, coverage: 0 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券"],
    financials: { revenue: 0, revenueGrowth: 0, operatingProfit: 0, isProfitable: false },
    per: null,
    psr: null,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: null,
    status: "upcoming",
    similarIpoCodes: [],
    ...overrides,
  };
}

const DEPOSIT: Broker = {
  id: "dep",
  name: "前受証券",
  lotteryType: "equal",
  requiresDeposit: true,
  penaltyOnCancel: false,
  underwriterCoefficient: 0,
};
const NO_DEPOSIT: Broker = { ...DEPOSIT, id: "nodep", name: "後払証券", requiresDeposit: false };
const OTHER: Broker = { ...DEPOSIT, id: "other", name: "別口証券" };

function period(code: string, start: string, end: string, amount = 100000, b: Broker = DEPOSIT): FundLockPeriod {
  return { ipo: ipo(code), broker: b, start, end, amount };
}

describe("periodsOverlap", () => {
  it("境界が同日（end === start）は重なりとみなす（閉区間）", () => {
    const a = period("A", "2026-10-01", "2026-10-05");
    const b = period("B", "2026-10-05", "2026-10-09");
    expect(periodsOverlap(a, b)).toBe(true);
    expect(periodsOverlap(b, a)).toBe(true);
  });

  it("1日でも離れていれば重ならない・包含は重なる", () => {
    const a = period("A", "2026-10-01", "2026-10-04");
    const b = period("B", "2026-10-05", "2026-10-09");
    const inner = period("C", "2026-10-06", "2026-10-07");
    expect(periodsOverlap(a, b)).toBe(false);
    expect(periodsOverlap(b, inner)).toBe(true);
  });
});

describe("buildFundLockPeriods", () => {
  it("前受金が必要な証券会社のみ・申込予定/申込済のみを対象にする", () => {
    const ipos = [ipo("A", { offeringPrice: 1200 })];
    const state: BbState = {
      A: {
        dep: { status: "applied" },
        nodep: { status: "applied" },
        other: { status: "won" },
      },
    };
    const periods = buildFundLockPeriods(ipos, [DEPOSIT, NO_DEPOSIT, OTHER], state);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      broker: { id: "dep" },
      start: "2026-10-09",
      end: "2026-10-15",
      amount: 120000,
    });
    const planned = buildFundLockPeriods(ipos, [DEPOSIT], { A: { dep: { status: "planned" } } });
    expect(planned).toHaveLength(1);
  });

  it("購入期間が無ければ BB期間開始〜抽選日、抽選日も無ければ BB期間終了を使う", () => {
    const state: BbState = { A: { dep: { status: "planned" } }, B: { dep: { status: "planned" } } };
    const noPurchase = ipo("A", { purchasePeriod: { start: "", end: "" } });
    const bbOnly = ipo("B", { purchasePeriod: { start: "", end: "" }, allotmentDate: "" });
    const periods = buildFundLockPeriods([noPurchase, bbOnly], [DEPOSIT], state);
    expect(periods.map((p) => [p.ipo.code, p.start, p.end])).toEqual([
      ["A", "2026-10-01", "2026-10-08"],
      ["B", "2026-10-01", "2026-10-07"],
    ]);
  });

  it("日付が確定していない銘柄・記録の無い銘柄は除外する", () => {
    const noDates = ipo("A", {
      bbPeriod: { start: "", end: "" },
      allotmentDate: "",
      purchasePeriod: { start: "", end: "" },
    });
    const state: BbState = { A: { dep: { status: "applied" } } };
    expect(buildFundLockPeriods([noDates, ipo("B")], [DEPOSIT], state)).toEqual([]);
  });

  it("todayIso 指定時は終了日が今日より前の期間を除外する（終了日が今日なら残す）", () => {
    const state: BbState = {
      A: { dep: { status: "applied" } },
      B: { dep: { status: "applied" } },
    };
    const past = ipo("A", { purchasePeriod: { start: "2026-09-01", end: "2026-09-24" } });
    const endsToday = ipo("B", { purchasePeriod: { start: "2026-09-20", end: "2026-09-25" } });
    const all = buildFundLockPeriods([past, endsToday], [DEPOSIT], state);
    expect(all.map((p) => p.ipo.code)).toEqual(["A", "B"]);
    const current = buildFundLockPeriods([past, endsToday], [DEPOSIT], state, "2026-09-25");
    expect(current.map((p) => p.ipo.code)).toEqual(["B"]);
  });
});

describe("groupOverlappingLocks", () => {
  it("同一証券会社の3銘柄が一部重なる場合: 重なる2件と単独1件に分かれる", () => {
    const a = period("A", "2026-10-01", "2026-10-05", 100000);
    const b = period("B", "2026-10-05", "2026-10-08", 200000);
    const c = period("C", "2026-10-12", "2026-10-14", 300000);
    const groups = groupOverlappingLocks([c, a, b]);
    expect(groups).toHaveLength(2);
    expect(groups[0].overlapping.map((p) => p.ipo.code)).toEqual(["A", "B"]);
    expect(groups[0].totalAmount).toBe(300000);
    expect(groups[0].peakAmount).toBe(300000);
    expect(groups[1].overlapping.map((p) => p.ipo.code)).toEqual(["C"]);
  });

  it("A-B・B-C が連鎖して重なれば1グループ。同時拘束の最大は peakAmount", () => {
    const a = period("A", "2026-10-01", "2026-10-04", 100000);
    const b = period("B", "2026-10-03", "2026-10-08", 200000);
    const c = period("C", "2026-10-06", "2026-10-10", 400000);
    const groups = groupOverlappingLocks([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].overlapping).toHaveLength(3);
    expect(groups[0].totalAmount).toBe(700000);
    // A と C は同時に拘束されないため、最大は B+C
    expect(groups[0].peakAmount).toBe(600000);
  });

  it("別の証券会社の期間は重なっていても同じグループにしない・空入力は空配列", () => {
    const a = period("A", "2026-10-01", "2026-10-05", 100000, DEPOSIT);
    const b = period("B", "2026-10-02", "2026-10-06", 100000, OTHER);
    const groups = groupOverlappingLocks([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.overlapping.length === 1)).toBe(true);
    expect(groupOverlappingLocks([])).toEqual([]);
  });
});
