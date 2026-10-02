import { describe, expect, it } from "vitest";
import { addDaysIso } from "../../src/lib/date";
import { isBusinessDay } from "../../src/lib/calendar/businessDays";
import {
  computeRightsBaseline,
  dailyIndicators,
  dailyCoversPreviousMonth,
  historicalLastCumDate,
  rightsWindow,
  rightsYearStat,
  summarizeRights,
  toDailyBars,
  type DailyBar,
} from "./yutai-daily";
import { buildYutaiFile, packRightsYears, rightsKey, serializeYutaiMonthFile, splitYutaiFile, type MonthBar } from "./yutai";
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
    // 買い前の足が 25 本ほどしかないので、位置・75 日線は null
    expect(rightsYearStat(bars, 3, 2025)).toEqual({
      year: 2025,
      ret: 0.05,
      hit10: true,
      maxHighRet: 0.12,
      posAtBuy: null,
      aboveMa75: null,
      maxDrawRet: 0,
    });
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
    const expectedRead = { ...rights, years: [{ ...rights.years[0], posAtBuy: null, aboveMa75: null, maxDrawRet: null }] };
    expect(file.months["3"].baseline?.rights?.winRate10).toBe(1);
    // ファイルでは年ごとの成績を配列に詰め、読み込むと元に戻る
    const text = serializeYutaiMonthFile(splitYutaiFile(file).months[0]);
    expect(text).toContain('"years":[[2025,0.05,0.02,0]]');
    expect(parseYutaiMonthFile(JSON.parse(text))?.items[0].rights).toMatchObject(expectedRead);
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

describe("日足の新指標（位置・75 日線・下押し）", () => {
  // 2024-01-01〜: 前半は 100 → 200 へ上がり、買い開始日（2025-02-03）直前は高値圏、期間中に 190 まで下押し
  const make = (buyOpen: number, trough: number) => {
    const bars = makeBars("2023-12-01", "2025-04-30", (d) => {
      if (d >= "2025-02-03") return buyOpen;
      // 買い前: 100〜200 を日数で線形に（時系列で単調増加）
      const t = (new Date(d).getTime() - new Date("2023-12-01").getTime()) / (new Date("2025-02-03").getTime() - new Date("2023-12-01").getTime());
      return 100 + 100 * t;
    });
    const i = bars.findIndex((b) => b.date === "2025-03-10");
    bars[i] = { ...bars[i], low: trough };
    return bars;
  };

  it("posAtBuy: 買い前 250 本の高安レンジの中の始値の位置", () => {
    const bars = make(200, 190);
    const st = rightsYearStat(bars, 3, 2025)!;
    // 直近 250 本の安値はおよそ 100 台前半、高値はおよそ 200 弱。始値 200 は上端以上 → 1
    expect(st.posAtBuy).toBe(1);
    const low = rightsYearStat(make(100, 100), 3, 2025)!;
    expect(low.posAtBuy).toBe(0);
  });

  it("aboveMa75: 買い値が直前 75 本の終値平均より上か", () => {
    expect(rightsYearStat(make(200, 190), 3, 2025)!.aboveMa75).toBe(true);
    expect(rightsYearStat(make(100, 100), 3, 2025)!.aboveMa75).toBe(false);
  });

  it("maxDrawRet: 期間中の最安値 / 買値 − 1（0 以下）", () => {
    expect(rightsYearStat(make(200, 190), 3, 2025)!.maxDrawRet).toBe(-0.05);
    // 買値より下がらなければ 0
    expect(rightsYearStat(make(200, 200), 3, 2025)!.maxDrawRet).toBe(0);
  });

  it("買い前の足が少ないと位置・75 日線は null", () => {
    const bars = makeBars("2025-01-06", "2025-04-30", () => 100);
    const st = rightsYearStat(bars, 3, 2025)!;
    expect(st.posAtBuy).toBeNull();
    expect(st.aboveMa75).toBeNull();
  });

  it("圧縮形式の往復。新項目が無い年は 4 要素のまま、古い配列は null で読める", () => {
    const full = { year: 2025, ret: 0.05, hit10: true, maxHighRet: 0.12, posAtBuy: 0.9, aboveMa75: true, maxDrawRet: -0.03 };
    const none = { year: 2024, ret: 0.01, hit10: false, maxHighRet: 0.02, posAtBuy: null, aboveMa75: null, maxDrawRet: null };
    const packed = packRightsYears([full, none]);
    expect(packed).toEqual([[2025, 0.05, 0.12, 1, 0.9, 1, -0.03], [2024, 0.01, 0.02, 0]]);
    const read = parseYutaiMonthFile({
      asOf: "2026-10-01",
      month: 3,
      items: [
        {
          code: "1111", name: "A", up10: 1, n10: 1, up5: 1, n5: 1, candles: [],
          rights: { years: packed, n10: 2, win10: 2, n5: 2, win5: 2 },
        },
      ],
    })!;
    expect(read.items[0].rights?.years).toEqual([full, none]);
  });

  it("summarizeRights: ゾーン別・75 日線別の勝ち数と下押しヒット数", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    // 2024 年 = 高値圏・線の上・勝ち・下押し −5%、2025 年 = 安値圏・線の下・負け・下押し 0
    const bars: DailyBar[] = [];
    const add = (from: string, to: string, f: (d: string) => number) => bars.push(...makeBars(from, to, f));
    add("2023-01-02", "2024-01-31", (d) => 100 + (new Date(d).getTime() - new Date("2023-01-02").getTime()) / 864e5 / 4);
    add("2024-02-01", "2024-03-27", (d) => (d === "2024-03-27" ? 260 : 250));
    add("2024-03-28", "2025-02-02", (d) => 300 - (new Date(d).getTime() - new Date("2024-03-28").getTime()) / 864e5 / 2);
    add("2025-02-03", "2025-04-30", (d) => (d === "2025-03-27" ? 80 : 90));
    const mid = bars.findIndex((b) => b.date === "2024-03-11");
    bars[mid] = { ...bars[mid], low: 237.5 };
    const r = summarizeRights(bars, 3, now)!;
    const y24 = r.years.find((y) => y.year === 2024)!;
    const y25 = r.years.find((y) => y.year === 2025)!;
    expect(y24.maxDrawRet).toBe(-0.05);
    expect(y24.aboveMa75).toBe(true);
    expect(y25.aboveMa75).toBe(false);
    expect(r.nAbove10).toBe(1);
    expect(r.winAbove10).toBe(1);
    expect(r.nBelow10).toBe(1);
    expect(r.winBelow10).toBe(0);
    // 下押し −2/−3/−5/−8%: 2024 が −5%（−8% には届かない）、2025 は 90 → 80 で −11.1%（全部届く）
    expect(y25.maxDrawRet).toBeCloseTo(-0.1111, 4);
    // 2023 年も数えられる（上昇相場で下押しは小さい）ので 2024・2025 年だけを見る
    expect(r.drawHits?.[3]).toBe(1);
    expect(r.drawHits?.[2]).toBe(2);
    const draws = r.years.map((y) => y.maxDrawRet as number);
    expect(r.avgDraw10).toBeCloseTo(draws.reduce((a, b) => a + b, 0) / draws.length, 4);
    // ゾーン別は posAtBuy の有無で数えられる年だけ（高/低/中の合計 ≤ 年数）
    expect((r.nHigh10 ?? 0) + (r.nLow10 ?? 0) + (r.nMid10 ?? 0)).toBeLessThanOrEqual(r.n10);
    expect(y24.posAtBuy).not.toBeNull();
    if ((y24.posAtBuy as number) >= 0.85) expect(r.nHigh10).toBeGreaterThanOrEqual(1);
  });

  it("地合い: 75 日線の上／下の勝率と下押しの平均", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    const y = (year: number, ret: number, above: boolean, draw: number) => ({
      year, ret, hit10: false, maxHighRet: 0.02, posAtBuy: 0.5, aboveMa75: above, maxDrawRet: draw,
    });
    const rights = (years: ReturnType<typeof y>[]) => ({ years, n10: years.length, win10: 0, hit10: 0, avgRet10: 0, avgHighRet10: 0, n5: 0, win5: 0 });
    const base = computeRightsBaseline(
      [{ rights: rights([y(2024, 0.1, true, -0.02), y(2025, -0.1, true, -0.04)]) }, { rights: rights([y(2025, 0.05, false, -0.06)]) }],
      now,
    )!;
    expect(base.winRateAbove).toBe(0.5);
    expect(base.winRateBelow).toBe(1);
    expect(base.avgDraw).toBeCloseTo(-0.04, 4);
  });
});

describe("dailyIndicators", () => {
  const series = (n: number) =>
    Array.from({ length: n }, (_, i): DailyBar => ({ date: addDaysIso("2025-01-01", i), open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }));

  it("足が無ければ null", () => {
    expect(dailyIndicators([])).toBeNull();
  });

  it("250 本ぶんあれば price・高安・移動平均・1 か月の指標が出る", () => {
    const ind = dailyIndicators(series(300))!;
    // 最後の足 i=299 → close 399。直近 250 本は i=50..299
    expect(ind.price).toBe(399);
    expect(ind.priceAsOf).toBe(addDaysIso("2025-01-01", 299));
    expect(ind.high12).toBe(400); // high = 101 + 299
    expect(ind.low12).toBe(149); // low = 99 + 50
    expect(ind.ma25).toBe(387); // 375..399 の平均
    expect(ind.ma75).toBe(362); // 325..399 の平均
    expect(ind.low1m).toBe(378); // 直近 21 本の最小 low = 99 + 279
    expect(ind.ret1m).toBeCloseTo(399 / 378 - 1, 4); // 21 本前の終値 = 100 + 278 = 378
  });

  it("足が足りない指標は null。120 本未満は高安も null（月足にフォールバック）", () => {
    const ind = dailyIndicators(series(30))!;
    expect(ind.price).toBe(129);
    expect(ind.high12).toBeNull();
    expect(ind.low12).toBeNull();
    expect(ind.ma25).not.toBeNull();
    expect(ind.ma75).toBeNull();
    const short = dailyIndicators(series(10))!;
    expect(short.ma25).toBeNull();
    expect(short.low1m).toBeNull();
    expect(short.ret1m).toBeNull();
  });

  it("buildYutaiFile: 日足の指標が月足の price/high12/low12 を上書きし、無い銘柄は月足のまま", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    const bars: MonthBar[] = [{ year: 2025, month: 2, open: 100, high: 110, low: 95, close: 105 }];
    const rows = ["1111", "2222"].map((code) => ({ code, name: code, minInvest: 1, rightsMonths: [3], detailUrl: "" }));
    const ind = dailyIndicators(series(300))!;
    const file = buildYutaiFile([{ month: 3, rows }], new Map(rows.map((r) => [r.code, bars])), now, {
      byKey: new Map(),
      baseline: computeRightsBaseline,
      indicatorsByCode: new Map([["1111", ind]]),
    });
    const [a, b] = ["1111", "2222"].map((c) => file.months["3"].items.find((it) => it.code === c)!);
    expect(a.price).toBe(399);
    expect(a.ma75).toBe(362);
    expect(b.price).toBe(105);
    expect(b.ma75).toBeUndefined();
  });
});
