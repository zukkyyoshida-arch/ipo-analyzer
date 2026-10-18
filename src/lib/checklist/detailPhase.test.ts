import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import { determineDetailPhase, isPreListingPhase, nextDeadline } from "./phase";

function ipoWith(overrides: Partial<Ipo> = {}): Ipo {
  return {
    status: "upcoming",
    listingDate: "2026-07-24",
    bbPeriod: { start: "2026-07-07", end: "2026-07-11" },
    allotmentDate: "2026-07-15",
    purchasePeriod: { start: "2026-07-16", end: "2026-07-22" },
    ...overrides,
  } as Ipo;
}

describe("determineDetailPhase", () => {
  it("日程から5区分を判定する", () => {
    const ipo = ipoWith();
    expect(determineDetailPhase(ipo, "2026-07-06")).toBe("preBb");
    expect(determineDetailPhase(ipo, "2026-07-07")).toBe("bbOpen");
    expect(determineDetailPhase(ipo, "2026-07-11")).toBe("bbOpen");
    expect(determineDetailPhase(ipo, "2026-07-12")).toBe("lottery");
    expect(determineDetailPhase(ipo, "2026-07-23")).toBe("lottery");
    expect(determineDetailPhase(ipo, "2026-07-24")).toBe("listingDay");
    expect(determineDetailPhase(ipo, "2026-07-25")).toBe("listed");
  });
  it("日程が欠けるときは status で補う", () => {
    const empty = { bbPeriod: { start: "", end: "" }, listingDate: "" };
    expect(determineDetailPhase(ipoWith({ ...empty, status: "upcoming" }), "2026-07-01")).toBe("preBb");
    expect(determineDetailPhase(ipoWith({ ...empty, status: "bb_open" }), "2026-07-01")).toBe("bbOpen");
    expect(determineDetailPhase(ipoWith({ ...empty, status: "priced" }), "2026-07-01")).toBe("lottery");
    expect(determineDetailPhase(ipoWith({ ...empty, status: "listed" }), "2026-07-01")).toBe("listed");
  });
  it("上場前フェーズの判定", () => {
    expect(isPreListingPhase("preBb")).toBe(true);
    expect(isPreListingPhase("lottery")).toBe(true);
    expect(isPreListingPhase("listingDay")).toBe(false);
    expect(isPreListingPhase("listed")).toBe(false);
  });
});

describe("nextDeadline", () => {
  const ipo = ipoWith();
  it("BB前はBB開始まで", () => {
    expect(nextDeadline(ipo, "2026-07-01")).toEqual({ label: "BB開始まで", date: "2026-07-07", daysLeft: 6 });
  });
  it("BB開始当日〜締切はBB締切まで", () => {
    expect(nextDeadline(ipo, "2026-07-07")).toEqual({ label: "BB締切まで", date: "2026-07-11", daysLeft: 4 });
    expect(nextDeadline(ipo, "2026-07-11")?.daysLeft).toBe(0);
  });
  it("抽選・購入・上場の順に進む", () => {
    expect(nextDeadline(ipo, "2026-07-12")?.label).toBe("抽選日まで");
    expect(nextDeadline(ipo, "2026-07-16")?.label).toBe("購入締切まで");
    expect(nextDeadline(ipo, "2026-07-23")?.label).toBe("上場日まで");
  });
  it("月またぎの日数", () => {
    expect(nextDeadline(ipoWith({ bbPeriod: { start: "2026-08-03", end: "2026-08-07" } }), "2026-07-30")?.daysLeft).toBe(4);
  });
  it("すべて過去・未取得なら null", () => {
    expect(nextDeadline(ipo, "2026-07-25")).toBeNull();
    expect(
      nextDeadline(
        ipoWith({ bbPeriod: { start: "", end: "" }, allotmentDate: "", purchasePeriod: { start: "", end: "" }, listingDate: "" }),
        "2026-07-01",
      ),
    ).toBeNull();
  });
});
