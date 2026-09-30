import { describe, expect, it } from "vitest";
import { buildSecondaryLines, describePosition, resolveBasePrice } from "./lines";
import { SECONDARY_PRESETS } from "./profiles";

const quote = (dates: string[], price: number, prevClose: number | null) => ({
  price,
  prevClose,
  closes: dates.map((date) => ({ date })),
});

describe("resolveBasePrice", () => {
  it("上場初日は初値", () => {
    const b = resolveBasePrice({
      todayIso: "2026-09-30",
      listingDate: "2026-09-30",
      initialCurrent: 2001,
      quote: quote(["2026-09-30"], 2300, null),
    });
    expect(b).toMatchObject({ price: 2001, source: "listingDay" });
  });
  it("最新の日足が今日なら前日終値", () => {
    const b = resolveBasePrice({
      todayIso: "2026-10-01",
      listingDate: "2026-09-30",
      initialCurrent: 2001,
      quote: quote(["2026-09-30", "2026-10-01"], 2600, 2501),
    });
    expect(b).toMatchObject({ price: 2501, source: "prevClose" });
  });
  it("最新の日足が今日より前なら、その終値が基準", () => {
    const b = resolveBasePrice({
      todayIso: "2026-10-03",
      listingDate: "2026-09-30",
      initialCurrent: 2001,
      quote: quote(["2026-09-30", "2026-10-02"], 2450, 2501),
    });
    expect(b).toMatchObject({ price: 2450, source: "lastClose" });
    expect(b.label).toContain("10/2の終値");
  });
  it("株価が取れなければ初値（初日基準）", () => {
    const b = resolveBasePrice({
      todayIso: "2026-10-03",
      listingDate: "2026-09-30",
      initialCurrent: 2001,
      quote: null,
    });
    expect(b).toMatchObject({ price: 2001, source: "initialFallback" });
  });
});

describe("buildSecondaryLines", () => {
  it("初値2001円・標準の型（ストップ高で利確・−10%）", () => {
    const lines = buildSecondaryLines({
      initialListing: 2001,
      factor: 1,
      base: 2001,
      profile: SECONDARY_PRESETS.standard,
    });
    const byKind = Object.fromEntries(lines.map((l) => [l.kind, l.price]));
    expect(byKind).toEqual({
      stopHigh: 2501,
      takeProfit: 2501,
      initial: 2001,
      stopLoss: 1800,
      stopLow: 1501,
    });
    expect(lines.map((l) => l.kind)).toEqual([
      "stopHigh",
      "takeProfit",
      "initial",
      "stopLoss",
      "stopLow",
    ]);
  });
  it("攻めの型は初日の値幅の200%（呼値に切り上げ）", () => {
    const lines = buildSecondaryLines({
      initialListing: 2001,
      factor: 1,
      base: 2501,
      profile: SECONDARY_PRESETS.aggressive,
    });
    expect(lines.find((l) => l.kind === "takeProfit")?.price).toBe(3005);
    expect(lines.find((l) => l.kind === "stopHigh")?.price).toBe(3005);
    expect(lines.find((l) => l.kind === "stopLow")?.price).toBe(2001);
  });
  it("株式分割後は初値基準の線を現在の単位に換算する", () => {
    const lines = buildSecondaryLines({
      initialListing: 2000,
      factor: 2,
      base: 1100,
      profile: SECONDARY_PRESETS.standard,
    });
    expect(lines.find((l) => l.kind === "initial")?.price).toBe(1000);
    expect(lines.find((l) => l.kind === "takeProfit")?.price).toBe(1250); // 2500 ÷ 2
    expect(lines.find((l) => l.kind === "stopHigh")?.price).toBe(1400); // 1100 + 300
  });
});

describe("describePosition", () => {
  const lines = buildSecondaryLines({
    initialListing: 2001,
    factor: 1,
    base: 2001,
    profile: SECONDARY_PRESETS.solid,
  });
  it("線の間", () => {
    expect(describePosition(2100, lines)).toBe("初値と利確線の間です");
    expect(describePosition(1900, lines)).toBe("損切り線と初値の間です");
  });
  it("端と同値", () => {
    expect(describePosition(2001, lines)).toBe("初値と同じ値です");
    expect(describePosition(1400, lines)).toBe("ストップ安より下です");
  });
});
