import { describe, expect, it } from "vitest";
import { earningsInWindow, splitExcluded, yutaiExclusion } from "./exclude";

// 11 月権利（2026-10-02 時点）: 買い開始日 2026-10-01、権利付最終日 2026-11-26
const T = "2026-10-02";
const mk = (code: string, nextEarningsDate: string | null, yutaiStatus?: "active" | "changed" | "abolished") => ({
  code, nextEarningsDate, yutaiStatus,
});

describe("earningsInWindow", () => {
  it("両端を含み、外側と null は false", () => {
    expect(earningsInWindow(mk("a", "2026-10-01"), 11, T)).toBe(true);
    expect(earningsInWindow(mk("a", "2026-11-26"), 11, T)).toBe(true);
    expect(earningsInWindow(mk("a", "2026-09-30"), 11, T)).toBe(false);
    expect(earningsInWindow(mk("a", "2026-11-27"), 11, T)).toBe(false);
    expect(earningsInWindow(mk("a", null), 11, T)).toBe(false);
  });

  it("権利付最終日を過ぎていれば来年の権利月で見る", () => {
    expect(earningsInWindow(mk("a", "2026-11-10"), 11, "2026-12-01")).toBe(false);
    expect(earningsInWindow(mk("a", "2027-11-10"), 11, "2026-12-01")).toBe(true);
  });
});

describe("yutaiExclusion / splitExcluded", () => {
  it("廃止を優先し、決算またぎは earnings", () => {
    expect(yutaiExclusion(mk("a", "2026-11-10", "abolished"), 11, T)).toBe("abolished");
    expect(yutaiExclusion(mk("a", "2026-11-10", "changed"), 11, T)).toBe("earnings");
    expect(yutaiExclusion(mk("a", null), 11, T)).toBeNull();
  });

  it("廃止は常に除外、決算またぎは hideEarnings のときだけ。順序は保つ", () => {
    const items = [mk("1", null), mk("2", "2026-11-10"), mk("3", null, "abolished"), mk("4", "2026-12-20")];
    const hide = splitExcluded(items, 11, T, { hideEarnings: true });
    expect(hide.shown.map((x) => x.code)).toEqual(["1", "4"]);
    expect(hide.excluded.map((x) => [x.item.code, x.reason])).toEqual([["2", "earnings"], ["3", "abolished"]]);
    const keep = splitExcluded(items, 11, T, { hideEarnings: false });
    expect(keep.shown.map((x) => x.code)).toEqual(["1", "2", "4"]);
    expect(keep.excluded.map((x) => x.reason)).toEqual(["abolished"]);
  });
});
