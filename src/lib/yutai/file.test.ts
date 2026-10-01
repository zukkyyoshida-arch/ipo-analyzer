import { describe, expect, it } from "vitest";
import { defaultYutaiMonth, isYutaiStale, monthLabel, parseYutaiMonthFile } from "./file";

describe("parseYutaiMonthFile", () => {
  const good = { code: "1111", name: "A", up10: 8, n10: 10, up5: 4, n5: 5, avgHighRet10: 0.068, candles: [{ year: 2020, open: 100, close: 110, high: 112, low: 99 }, { year: "x" }] };

  it("items が空でも asOf と月が正しければ返す。asOf・月が崩れていれば null", () => {
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, items: [] })?.items).toEqual([]);
    expect(parseYutaiMonthFile({ asOf: "", month: 12, items: [] })).toBeNull();
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 13, items: [] })).toBeNull();
    expect(parseYutaiMonthFile(null)).toBeNull();
    expect(parseYutaiMonthFile([])).toBeNull();
  });

  it("形の崩れた銘柄・月足は落とし、高値と最大上昇も読む", () => {
    const f = parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, prevMonth: 11, items: [good, { code: "" }, "x"] })!;
    expect(f.asOf).toBe("2026-10-01");
    expect(f.items).toHaveLength(1);
    expect(f.items[0].candles).toHaveLength(1);
    expect(f.items[0].minInvest).toBeNull();
    expect(f.items[0].avgHighRet10).toBe(0.068);
    expect(f.items[0].candles[0].high).toBe(112);
    expect(f.items[0]).not.toHaveProperty("yutaiYield");
    expect(f.baseline).toBeNull(); // 地合いの無い古いファイル
  });

  it("地合い（baseline）を読み、崩れた年は落とす", () => {
    const f = parseYutaiMonthFile({
      asOf: "2026-10-01",
      month: 12,
      items: [],
      baseline: {
        n: 229,
        winRate10: 0.55,
        avgRet10: 0.018,
        avgHighRet10: 0.061,
        years: [{ year: 2016, n: 180, winRate: 0.6, avgRet: 0.02, avgHighRet: 0.07 }, { year: "x" }],
      },
    })!;
    expect(f.baseline).toEqual({
      n: 229,
      winRate10: 0.55,
      avgRet10: 0.018,
      avgHighRet10: 0.061,
      years: [{ year: 2016, n: 180, winRate: 0.6, avgRet: 0.02, avgHighRet: 0.07 }],
    });
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, items: [], baseline: { n: "x" } })!.baseline).toBeNull();
  });
});

describe("isYutaiStale / defaultYutaiMonth / monthLabel", () => {
  it("60 日以上前なら古い", () => {
    expect(isYutaiStale("2026-10-01", "2026-11-29")).toBe(false);
    expect(isYutaiStale("2026-10-01", "2026-11-30")).toBe(true);
    expect(isYutaiStale("", "2026-11-30")).toBe(true);
  });
  it("既定は今月＋2、12 を超えたら折り返す", () => {
    expect(defaultYutaiMonth("2026-10-01")).toBe(12);
    expect(defaultYutaiMonth("2026-11-15")).toBe(1);
    expect(defaultYutaiMonth("2026-12-31")).toBe(2);
    expect(defaultYutaiMonth("2026-01-01")).toBe(3);
  });
  it("月の表示", () => {
    expect(monthLabel(12)).toBe("12月");
  });
});
