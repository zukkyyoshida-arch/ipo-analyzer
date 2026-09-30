import { describe, expect, it } from "vitest";
import type { QuotePoint } from "@/lib/quote";
import { buildMidFile, computeMidMetrics, currentTier, parseMidFile } from "./file";
import { toOhlcBars } from "@/lib/chart/ohlc";

/** 2026-09-01 から毎日 1 本。closes の値で OHLC を同じにする（high/low は ±0）。 */
function quotes(closes: number[], start = 1, volume = 200_000): QuotePoint[] {
  return closes.map((c, i) => {
    const d = new Date(Date.UTC(2026, 7, start + i)).toISOString().slice(0, 10);
    return { date: d, open: c, high: c, low: c, close: c, volume };
  });
}

describe("computeMidMetrics", () => {
  it("上場来高値・下落率・安値からの戻り・段階の初到達日（初日は除く）", () => {
    const m = computeMidMetrics(toOhlcBars(quotes([1000, 600, 500, 380, 420])))!;
    expect(m.ath).toBe(1000);
    expect(m.drawdown).toBeCloseTo(-0.58);
    expect(m.low).toBe(380);
    expect(m.rebound).toBeCloseTo(420 / 380 - 1);
    expect(m.hits).toEqual({ "40": "2026-08-02", "50": "2026-08-03", "60": "2026-08-04" });
    expect(m.avgVolume20).toBe(200_000);
  });

  it("ちょうど −60% も到達とみなす", () => {
    expect(currentTier(-0.6)).toBe(60);
    expect(currentTier(-0.5)).toBe(50);
    expect(currentTier(-0.39)).toBeNull();
  });
});

describe("buildMidFile / parseMidFile", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  it("−40% 以下だけ書き、対象数は 5 本以上・基準日の足がある銘柄", () => {
    const f = buildMidFile(
      [
        { code: "A", name: "深い", listingDate: "2026-08-01", quotes: quotes([1000, 800, 600, 450, 350]) },
        { code: "B", name: "浅い", listingDate: "2026-08-01", quotes: quotes([1000, 990, 980, 970, 960]) },
        { code: "C", name: "本数不足", listingDate: "2026-08-02", quotes: quotes([1000, 300, 300, 300], 2) },
        { code: "D", name: "古い足", listingDate: "2026-08-01", quotes: quotes([1000, 400, 300, 200]) },
      ],
      now,
    );
    expect(f.asOf).toBe("2026-08-05");
    expect(f.universe).toBe(2);
    expect(f.items.map((i) => i.code)).toEqual(["A"]);
    expect(f.items[0].drawdown).toBe(-0.65);
    const parsed = parseMidFile(JSON.parse(JSON.stringify(f)));
    expect(parsed?.items[0]).toEqual(f.items[0]);
  });

  it("形の崩れたファイル・行は捨てる", () => {
    expect(parseMidFile({ asOf: "x" })).toBeNull();
    expect(parseMidFile({ asOf: "2026-09-29", items: [{ code: "A" }] })?.items).toEqual([]);
  });
});
