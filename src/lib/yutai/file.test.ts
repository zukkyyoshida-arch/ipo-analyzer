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
      rights: null,
    });
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, items: [], baseline: { n: "x" } })!.baseline).toBeNull();
  });
});

describe("日足ベースの成績（rights）", () => {
  const rights = {
    years: [{ year: 2024, ret: 0.05, hit10: true, maxHighRet: 0.12 }, { year: "x" }, [2025, -0.01, 0.03, 0], ["x"]],
    n10: 1,
    win10: 1,
    hit10: 1,
    avgRet10: 0.05,
    avgHighRet10: 0.12,
    n5: 1,
    win5: 1,
  };
  const base = { code: "1111", name: "A", up10: 8, n10: 10, up5: 4, n5: 5, candles: [] };

  it("銘柄の rights を読み、崩れた年は落とす。無い・崩れていれば null", () => {
    const f = parseYutaiMonthFile({
      asOf: "2026-10-01",
      month: 3,
      items: [{ ...base, rights }, { ...base, code: "2222" }, { ...base, code: "3333", rights: { n10: "x" } }],
    })!;
    // 古い形（新項目なし）は、年ごとは null・集計は 0 / null で読める
    expect(f.items[0].rights).toMatchObject({
      ...rights,
      years: [
        { year: 2024, ret: 0.05, hit10: true, maxHighRet: 0.12, posAtBuy: null, aboveMa75: null, maxDrawRet: null },
        { year: 2025, ret: -0.01, hit10: false, maxHighRet: 0.03, posAtBuy: null, aboveMa75: null, maxDrawRet: null },
      ],
      nHigh10: 0,
      avgDraw10: null,
      drawHits: [0, 0, 0, 0],
    });
    expect(f.items[1].rights).toBeNull();
    expect(f.items[2].rights).toBeNull();
  });

  it("地合いの rights を読む", () => {
    const f = parseYutaiMonthFile({
      asOf: "2026-10-01",
      month: 3,
      items: [],
      baseline: {
        n: 10,
        winRate10: 0.5,
        avgRet10: 0.01,
        avgHighRet10: 0.05,
        years: [],
        rights: { n: 9, winRate10: 0.52, avgRet10: 0.012, hit10Rate10: 0.2, avgHighRet10: 0.06, years: [{ year: 2025, n: 9, winRate: 0.6, avgRet: 0.02, hit10Rate: 0.3 }] },
      },
    })!;
    expect(f.baseline?.rights?.hit10Rate10).toBe(0.2);
    expect(f.baseline?.rights?.years[0].hit10Rate).toBe(0.3);
  });
});

describe("isYutaiStale / defaultYutaiMonth / monthLabel", () => {
  it("60 日以上前なら古い", () => {
    expect(isYutaiStale("2026-10-01", "2026-11-29")).toBe(false);
    expect(isYutaiStale("2026-10-01", "2026-11-30")).toBe(true);
    expect(isYutaiStale("", "2026-11-30")).toBe(true);
  });
  it("既定は今月＋1（今月買う分）、12 を超えたら折り返す", () => {
    expect(defaultYutaiMonth("2026-10-01")).toBe(11);
    expect(defaultYutaiMonth("2026-11-15")).toBe(12);
    expect(defaultYutaiMonth("2026-12-31")).toBe(1);
    expect(defaultYutaiMonth("2026-01-01")).toBe(2);
  });
  it("月の表示", () => {
    expect(monthLabel(12)).toBe("12月");
  });
});

describe("basket の読み込み", () => {
  it("無ければ null、あれば読み、崩れた年・統計は落とす", () => {
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, items: [] })!.basket).toBeNull();
    const f = parseYutaiMonthFile({
      asOf: "2026-10-01",
      month: 12,
      items: [],
      basket: {
        byTopN: {
          "3": {
            topN: 3,
            years: [{ year: 2021, ret: 0.05, n: 3, codes: ["1111", 5] }, { year: "x" }],
            n: 1,
            wins: 1,
            avgRet: 0.05,
            maxDrawdown: 0,
            best: { year: 2021, ret: 0.05 },
            worst: null,
          },
          "5": "x",
        },
      },
    })!;
    expect(Object.keys(f.basket!.byTopN)).toEqual(["3"]);
    expect(f.basket!.byTopN["3"].years).toEqual([{ year: 2021, ret: 0.05, n: 3, codes: ["1111"] }]);
    expect(f.basket!.byTopN["3"].worst).toBeNull();
    expect(parseYutaiMonthFile({ asOf: "2026-10-01", month: 12, items: [], basket: { byTopN: {} } })!.basket).toBeNull();
  });
});
