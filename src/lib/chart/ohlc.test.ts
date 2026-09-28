import { describe, it, expect } from "vitest";
import {
  extendRangeWithReferences,
  formatChartPrice,
  formatVolumeJa,
  periodStartIndex,
  recentCloses,
  subtractMonths,
  toOhlcBars,
  withAlpha,
  type OhlcBar,
} from "./ohlc";

function bar(date: string, close: number, volume: number | null = 1000): OhlcBar {
  return { date, open: close, high: close, low: close, close, volume };
}

describe("toOhlcBars", () => {
  it("日付昇順に並べ、同じ日付は後ろの行を採用する", () => {
    const bars = toOhlcBars([
      { date: "2026-09-02", open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { date: "2026-09-01", open: 9, high: 10, low: 8, close: 10, volume: 100 },
      { date: "2026-09-02", open: 10, high: 13, low: 9, close: 12, volume: 200 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(bars[1].close).toBe(12);
    expect(bars[1].volume).toBe(200);
  });

  it("OHLC が欠けた日・0以下の値は捨てる", () => {
    const bars = toOhlcBars([
      { date: "2026-09-01", close: 10, volume: 100 },
      { date: "2026-09-02", open: null, high: 12, low: 9, close: 11, volume: 100 },
      { date: "2026-09-03", open: 0, high: 12, low: 9, close: 11, volume: 100 },
      { date: "2026-09-04", open: 10, high: 12, low: 9, close: 11, volume: 100 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2026-09-04"]);
  });

  it("出来高 0 の穴埋め行を捨てる（8303 の上場前後の事例）", () => {
    const filler = 55319998464;
    const bars = toOhlcBars([
      { date: "2025-11-17", open: filler, high: filler, low: filler, close: filler, volume: 0 },
      { date: "2025-12-17", open: filler, high: filler, low: filler, close: filler, volume: 0 },
      { date: "2025-12-18", open: 1632, high: 1850, low: 1600, close: 1813, volume: 79182300 },
      { date: "2025-12-19", open: 1813, high: 1813, low: 1813, close: 1813, volume: 0 },
      { date: "2025-12-22", open: 1789, high: 1800, low: 1682, close: 1721, volume: 22892000 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2025-12-18", "2025-12-22"]);
  });

  it("1日の値幅が5倍を超える壊れた行を捨てる", () => {
    const bars = toOhlcBars([
      { date: "2026-09-01", open: 55319998464, high: 55319998464, low: 1600, close: 1632, volume: 100 },
      { date: "2026-09-02", open: 1632, high: 1700, low: 1600, close: 1650, volume: 100 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2026-09-02"]);
  });

  it("出来高が全て不明なら行は残す", () => {
    const bars = toOhlcBars([
      { date: "2026-09-01", open: 9, high: 10, low: 8, close: 10, volume: null },
      { date: "2026-09-02", open: 10, high: 12, low: 9, close: 11, volume: null },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0].volume).toBeNull();
  });

  it("空配列なら空配列", () => {
    expect(toOhlcBars([])).toEqual([]);
  });
});

describe("subtractMonths / periodStartIndex", () => {
  it("暦月で遡る", () => {
    expect(subtractMonths("2026-09-28", 1)).toBe("2026-08-28");
    expect(subtractMonths("2026-01-15", 3)).toBe("2025-10-15");
    expect(subtractMonths("2026-09-28", 12)).toBe("2025-09-28");
  });

  it("期間内の最初の足を返し、データが短ければ 0", () => {
    const bars = [
      bar("2026-06-01", 1),
      bar("2026-07-01", 2),
      bar("2026-08-28", 3),
      bar("2026-09-28", 4),
    ];
    expect(periodStartIndex(bars, 1)).toBe(2);
    expect(periodStartIndex(bars, 3)).toBe(1);
    expect(periodStartIndex(bars, 12)).toBe(0);
    expect(periodStartIndex([], 1)).toBe(0);
  });
});

describe("recentCloses", () => {
  it("最終足から days 暦日以内の終値だけ返す", () => {
    const bars = [bar("2026-01-01", 1), bar("2026-06-01", 2), bar("2026-09-28", 3)];
    expect(recentCloses(bars, 120)).toEqual([2, 3]);
    expect(recentCloses([], 120)).toEqual([]);
  });
});

describe("extendRangeWithReferences", () => {
  it("値幅の半分以内の参照線は範囲に含める", () => {
    expect(extendRangeWithReferences({ minValue: 1200, maxValue: 2600 }, [1000, 3200])).toEqual({
      minValue: 1000,
      maxValue: 3200,
    });
  });

  it("遠すぎる参照線は含めない（5537 の 3M: 足 2,550〜3,900 に対し公開価格 1,300）", () => {
    expect(
      extendRangeWithReferences({ minValue: 2550, maxValue: 3900 }, [1300, 1850]),
    ).toEqual({ minValue: 2550, maxValue: 3900 });
  });

  it("値幅が極端に狭くても最低限（価格の2%）は判定幅を取る", () => {
    expect(extendRangeWithReferences({ minValue: 1000, maxValue: 1000 }, [985, 900])).toEqual({
      minValue: 985,
      maxValue: 1000,
    });
  });
});

describe("フォーマット", () => {
  it("価格は1000円以上を整数、未満を小数1桁まで", () => {
    expect(formatChartPrice(1632.4)).toBe("1,632");
    expect(formatChartPrice(512.34)).toBe("512.3");
  });

  it("出来高は万・億で丸める", () => {
    expect(formatVolumeJa(null)).toBe("—");
    expect(formatVolumeJa(9500)).toBe("9,500");
    expect(formatVolumeJa(79182300)).toBe("7,918.2万");
    expect(formatVolumeJa(123456789)).toBe("1.23億");
  });

  it("色に透明度を掛ける", () => {
    expect(withAlpha("#2ba640", 0.5)).toBe("rgba(43, 166, 64, 0.5)");
    expect(withAlpha("#fff", 0.2)).toBe("rgba(255, 255, 255, 0.2)");
    expect(withAlpha("rgba(62, 166, 255, 0.5)", 0.5)).toBe("rgba(62, 166, 255, 0.25)");
    expect(withAlpha("rgb(1, 2, 3)", 0.4)).toBe("rgba(1, 2, 3, 0.4)");
    expect(withAlpha("red", 0.5)).toBe("red");
  });
});
