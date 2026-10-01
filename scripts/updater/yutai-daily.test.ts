import { describe, expect, it } from "vitest";
import { addDaysIso } from "../../src/lib/date";
import { isBusinessDay } from "../../src/lib/calendar/businessDays";
import {
  computeRightsBaseline,
  dailyCoversPreviousMonth,
  historicalLastCumDate,
  rightsWindow,
  rightsYearStat,
  summarizeRights,
  toDailyBars,
  type DailyBar,
} from "./yutai-daily";
import { buildYutaiFile, rightsKey, serializeYutaiMonthFile, splitYutaiFile, type MonthBar } from "./yutai";
import { parseYutaiMonthFile } from "../../src/lib/yutai/file";

/** from〜to の営業日に、price(日付) で決まる足を並べる（始値=終値=price、高値=price×highMul）。 */
function makeBars(from: string, to: string, price: (d: string) => number, highMul = 1): DailyBar[] {
  const out: DailyBar[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    if (!isBusinessDay(d)) continue;
    const p = price(d);
    out.push({ date: d, open: p, high: p * highMul, low: p, close: p });
  }
  return out;
}

describe("権利付最終日（過去）", () => {
  it("2019 年 7 月以降は最終営業日の 2 営業日前", () => {
    // 2025-03-31（月）が最終営業日 → 2 営業日前は 03-27（木）
    expect(historicalLastCumDate(2025, 3)).toBe("2025-03-27");
    expect(historicalLastCumDate(2019, 9)).toBe("2019-09-26");
  });

  it("2019 年 6 月以前は T+3 なので 3 営業日前", () => {
    // 2018-03-30（金）が最終営業日 → 3 営業日前は 03-27（火）
    expect(historicalLastCumDate(2018, 3)).toBe("2018-03-27");
  });

  it("売買期間: 前月の最初の営業日〜権利付最終日。1 月権利は前年 12 月に買う", () => {
    expect(rightsWindow(3, 2025)).toEqual({ buy: "2025-02-03", sell: "2025-03-27" });
    expect(rightsWindow(1, 2024)).toEqual({ buy: "2024-12-02", sell: "2025-01-29" });
    // 2016 年は祝日表あり: 2016-05-02 は平日（5/3〜5 が祝日）
    expect(rightsWindow(6, 2016).buy).toBe("2016-05-02");
  });
});

describe("toDailyBars", () => {
  it("JST の日付にし、同じ日のライブ行をまとめる", () => {
    const bars = toDailyBars([
      { date: "2025-03-03T00:00:00.000Z", open: 100, high: 105, low: 99, close: 104 },
      { date: "2025-03-04T00:00:00.000Z", open: 104, high: 106, low: 103, close: 105 },
      { date: "2025-03-04T06:30:00.000Z", open: 105, high: 108, low: 101, close: 107 },
    ]);
    expect(bars).toEqual([
      { date: "2025-03-03", open: 100, high: 105, low: 99, close: 104 },
      { date: "2025-03-04", open: 104, high: 108, low: 101, close: 107 },
    ]);
  });

  it("未反映の分割（前日終値→当日始値が 1/4）は古い側を補正する", () => {
    const bars = toDailyBars([
      { date: "2025-03-03T00:00:00.000Z", open: 4000, high: 4100, low: 3990, close: 4000 },
      { date: "2025-03-04T00:00:00.000Z", open: 1000, high: 1010, low: 990, close: 1005 },
    ]);
    expect(bars[0].open).toBe(1000);
    expect(bars[0].high).toBe(1025);
  });
});

describe("rightsYearStat", () => {
  it("買い開始日の始値で買い、権利付最終日の終値で売る。高値は期間中の最大", () => {
    // 3 月権利・2025 年: 2025-02-03 買い、2025-03-27 売り
    const bars = makeBars("2025-01-06", "2025-04-30", (d) => (d < "2025-02-03" ? 90 : d <= "2025-03-27" ? 100 + (d === "2025-03-27" ? 5 : 0) : 200));
    // 期間中の 1 日だけ高値 112
    const i = bars.findIndex((b) => b.date === "2025-03-10");
    bars[i] = { ...bars[i], high: 112 };
    expect(rightsYearStat(bars, 3, 2025)).toEqual({ year: 2025, ret: 0.05, hit10: true, maxHighRet: 0.12 });
  });

  it("負けの年・+10% 未達", () => {
    const bars = makeBars("2025-01-06", "2025-04-30", (d) => (d === "2025-03-27" ? 95 : 100), 1.05);
    const s = rightsYearStat(bars, 3, 2025);
    expect(s?.ret).toBe(-0.05);
    expect(s?.hit10).toBe(false);
    expect(s?.maxHighRet).toBe(0.05);
  });

  it("買い開始日の足が無く、3 営業日以内にも無ければ null（上場前）", () => {
    const bars = makeBars("2025-02-20", "2025-04-30", () => 100);
    expect(rightsYearStat(bars, 3, 2025)).toBeNull();
  });

  it("データが期間の途中で終わっていれば null", () => {
    const bars = makeBars("2025-01-06", "2025-03-10", () => 100);
    expect(rightsYearStat(bars, 3, 2025)).toBeNull();
  });
});

describe("summarizeRights", () => {
  const now = new Date("2026-10-01T03:00:00Z");

  it("直近 10 年（2016〜25）の勝ち数・+10% 到達・平均、直近 5 年（2021〜25）の勝ち数", () => {
    // 毎年、買い 100 → 売り: 奇数年 110（勝ち・+10%）、偶数年 98（負け）
    const bars = makeBars("2015-11-02", "2026-09-30", (d) => {
      const y = Number(d.slice(0, 4));
      const md = d.slice(5);
      // 3 月の権利付最終日付近（03-20 以降）だけ値を変える
      if (md >= "03-20" && md <= "03-31") return y % 2 === 1 ? 110 : 98;
      return 100;
    });
    const r = summarizeRights(bars, 3, now);
    expect(r).not.toBeNull();
    expect(r!.n10).toBe(10);
    expect(r!.years.map((y) => y.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(r!.win10).toBe(5);
    expect(r!.hit10).toBe(5);
    expect(r!.n5).toBe(5);
    expect(r!.win5).toBe(3); // 2021・2023・2025
    expect(r!.avgRet10).toBeCloseTo(0.04, 4);
  });

  it("1 年も取れなければ null", () => {
    expect(summarizeRights([], 3, now)).toBeNull();
  });
});

describe("computeRightsBaseline / buildYutaiFile", () => {
  const now = new Date("2026-10-01T03:00:00Z");
  const r = (year: number, ret: number, hit10: boolean) => ({ year, ret, hit10, maxHighRet: hit10 ? 0.12 : 0.02 });

  it("銘柄×年を同じ重みで数える", () => {
    const base = computeRightsBaseline(
      [
        { rights: { years: [r(2024, 0.1, true), r(2025, -0.02, false)], n10: 2, win10: 1, hit10: 1, avgRet10: 0.04, avgHighRet10: 0.07, n5: 2, win5: 1 } },
        { rights: { years: [r(2025, 0.04, false)], n10: 1, win10: 1, hit10: 0, avgRet10: 0.04, avgHighRet10: 0.02, n5: 1, win5: 1 } },
        { rights: null },
      ],
      now,
    );
    expect(base?.n).toBe(2);
    expect(base?.winRate10).toBeCloseTo(2 / 3, 4);
    expect(base?.hit10Rate10).toBeCloseTo(1 / 3, 4);
    expect(base?.avgRet10).toBeCloseTo(0.04, 4);
    expect(base?.years.find((y) => y.year === 2025)).toEqual({ year: 2025, n: 2, winRate: 0.5, avgRet: 0.01, hit10Rate: 0 });
    expect(base?.years.find((y) => y.year === 2016)?.n).toBe(0);
  });

  it("日足が 1 銘柄も無ければ null", () => {
    expect(computeRightsBaseline([{ rights: null }], now)).toBeNull();
  });

  it("buildYutaiFile に rights を渡すと items と baseline に付く", () => {
    const bars: MonthBar[] = [{ year: 2025, month: 2, open: 100, high: 110, low: 95, close: 105 }];
    const row = { code: "1234", name: "テスト", minInvest: 100000, rightsMonths: [3], detailUrl: "" };
    const rights = { years: [r(2025, 0.05, false)], n10: 1, win10: 1, hit10: 0, avgRet10: 0.05, avgHighRet10: 0.02, n5: 1, win5: 1 };
    const file = buildYutaiFile([{ month: 3, rows: [row] }], new Map([["1234", bars]]), now, {
      byKey: new Map([[rightsKey(3, "1234"), rights]]),
      baseline: computeRightsBaseline,
    });
    expect(file.months["3"].items[0].rights).toEqual(rights);
    expect(file.months["3"].baseline?.rights?.winRate10).toBe(1);
    // ファイルでは年ごとの成績を配列に詰め、読み込むと元に戻る
    const text = serializeYutaiMonthFile(splitYutaiFile(file).months[0]);
    expect(text).toContain('"years":[[2025,0.05,0.02,0]]');
    expect(parseYutaiMonthFile(JSON.parse(text))?.items[0].rights).toEqual(rights);
  });
});

describe("dailyCoversPreviousMonth", () => {
  it("最後の足が前月の最終営業日以降なら揃っている", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    expect(dailyCoversPreviousMonth([{ date: "2026-09-30T00:00:00.000Z", open: 1, close: 1 }], now)).toBe(true);
    expect(dailyCoversPreviousMonth([{ date: "2026-09-29T00:00:00.000Z", open: 1, close: 1 }], now)).toBe(false);
    expect(dailyCoversPreviousMonth([], now)).toBe(false);
  });
});
