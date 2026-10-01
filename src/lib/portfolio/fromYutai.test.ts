import { describe, expect, it } from "vitest";
import { holdingFromYutai, isHeldForYutai } from "./fromYutai";

const input = { id: "x1", code: "3160", name: "テスト", price: 1234.56, shares: 300, rightsMonth: 12, todayIso: "2026-10-01" };

describe("holdingFromYutai", () => {
  it("買値＝株価・株数＝推奨株数・戦略＝優待・権利確定月・買付日＝今日", () => {
    expect(holdingFromYutai(input)).toEqual({
      id: "x1",
      code: "3160",
      name: "テスト",
      buyPrice: 1234.6,
      shares: 300,
      buyDate: "2026-10-01",
      strategy: "yutai",
      rightsMonth: 12,
      earningsDate: null,
      memo: "",
      manualPrice: null,
      sold: null,
    });
  });

  it("推奨株数が無い・0 なら 100 株、株価が無ければ null", () => {
    expect(holdingFromYutai({ ...input, shares: null })?.shares).toBe(100);
    expect(holdingFromYutai({ ...input, shares: 0 })?.shares).toBe(100);
    expect(holdingFromYutai({ ...input, price: null })).toBeNull();
  });
});

describe("isHeldForYutai", () => {
  const h = holdingFromYutai(input)!;
  it("同じ銘柄・同じ権利確定月の優待を保有中なら true。売却済み・別の月・別の戦略は false", () => {
    expect(isHeldForYutai([h], "3160", 12)).toBe(true);
    expect(isHeldForYutai([h], "3160", 6)).toBe(false);
    expect(isHeldForYutai([{ ...h, sold: { price: 1300, date: "2026-12-20" } }], "3160", 12)).toBe(false);
    expect(isHeldForYutai([{ ...h, strategy: "other", rightsMonth: null }], "3160", 12)).toBe(false);
  });
});
