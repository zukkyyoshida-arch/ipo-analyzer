import { describe, expect, it } from "vitest";
import type { OhlcBar } from "@/lib/chart/ohlc";
import type { QuotePoint } from "@/lib/quote";
import { addDaysIso } from "@/lib/date";
import {
  HOT_MIN_TURNOVER,
  buildHotRanking,
  computeHotMetrics,
  hotReasons,
  initialRatioOf,
  isSinceListingReturn,
  percentileRanks,
  type HotCandidate,
  type HotMetrics,
} from "./score";

/** 2026-01-05 から1日ずつの日足（close と volume を並べて作る。open は前日終値、high は close）。 */
function bars(closes: number[], volumes?: number[], firstOpen = closes[0]): OhlcBar[] {
  return closes.map((close, i) => ({
    date: addDaysIso("2026-01-05", i),
    open: i === 0 ? firstOpen : closes[i - 1],
    high: close,
    low: close,
    close,
    volume: volumes ? volumes[i] : 1_000_000,
  }));
}

function metrics(overrides: Partial<HotMetrics> = {}): HotMetrics {
  return { bars: 30, r5: 0, r20: 0, volRatio: 1, highProx: 0.5, turnover5: 1e9, ...overrides };
}

describe("computeHotMetrics", () => {
  it("1本以下は null", () => {
    expect(computeHotMetrics([])).toBeNull();
    expect(computeHotMetrics(bars([100]))).toBeNull();
  });

  it("2本: r5・r20 は最初の足の始値が基準、volRatio は null", () => {
    const m = computeHotMetrics(bars([110, 121], [1000, 3000], 100));
    expect(m).not.toBeNull();
    expect(m!.bars).toBe(2);
    expect(m!.r5).toBeCloseTo(0.21, 10);
    expect(m!.r20).toBeCloseTo(0.21, 10);
    expect(m!.volRatio).toBeNull();
    expect(m!.highProx).toBe(1);
    // (110×1000 + 121×3000) / 2
    expect(m!.turnover5).toBe((110 * 1000 + 121 * 3000) / 2);
  });

  it("5本: n-6 < 0 なので r5 も始値が基準", () => {
    const m = computeHotMetrics(bars([100, 101, 102, 103, 120], undefined, 80));
    expect(m!.r5).toBeCloseTo(120 / 80 - 1, 10);
    expect(m!.r20).toBeCloseTo(120 / 80 - 1, 10);
  });

  it("6本: r5 は最初の足の終値が基準、r20 は始値が基準", () => {
    const m = computeHotMetrics(bars([100, 101, 102, 103, 104, 120], undefined, 80));
    expect(m!.r5).toBeCloseTo(0.2, 10);
    expect(m!.r20).toBeCloseTo(120 / 80 - 1, 10);
  });

  it("25本: volRatio = 直近5本平均 ÷ その前20本平均、r20 は 20本前の終値が基準", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
    const volumes = [...Array(20).fill(1000), ...Array(5).fill(3000)];
    const m = computeHotMetrics(bars(closes, volumes));
    expect(m!.bars).toBe(25);
    expect(m!.volRatio).toBeCloseTo(3, 10);
    expect(m!.r5).toBeCloseTo(124 / 119 - 1, 10);
    expect(m!.r20).toBeCloseTo(124 / 104 - 1, 10);
    expect(m!.turnover5).toBeCloseTo(((120 + 121 + 122 + 123 + 124) / 5) * 3000, 6);
  });

  it("24本は volRatio が null", () => {
    const closes = Array.from({ length: 24 }, (_, i) => 100 + i);
    expect(computeHotMetrics(bars(closes))!.volRatio).toBeNull();
  });

  it("前20本の出来高が全部 0 なら volRatio は null", () => {
    const closes = Array.from({ length: 25 }, () => 100);
    const volumes = [...Array(20).fill(0), ...Array(5).fill(1000)];
    expect(computeHotMetrics(bars(closes, volumes))!.volRatio).toBeNull();
  });

  it("highProx は上場来の高値（high の最大）に対する終値", () => {
    const b = bars([100, 200, 150]);
    b[1].high = 250;
    expect(computeHotMetrics(b)!.highProx).toBeCloseTo(150 / 250, 10);
  });

  it("出来高が不明な足は売買代金の平均から外す", () => {
    const b = bars([100, 100, 100], [1000, 2000, 3000]);
    b[2].volume = null;
    expect(computeHotMetrics(b)!.turnover5).toBe((100 * 1000 + 100 * 2000) / 2);
  });
});

describe("percentileRanks", () => {
  it("最小 0・最大 100 で等間隔", () => {
    expect(percentileRanks([3, 1, 2])).toEqual([100, 0, 50]);
  });

  it("同じ値は平均順位", () => {
    // 1, 2, 2, 4 → 順位 1, 2.5, 2.5, 4 → (r-1)/3×100
    const p = percentileRanks([1, 2, 2, 4]);
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(50, 10);
    expect(p[2]).toBeCloseTo(50, 10);
    expect(p[3]).toBe(100);
  });

  it("null は 50 で、順位の母数に入れない", () => {
    expect(percentileRanks([null, 5, 1])).toEqual([50, 100, 0]);
  });

  it("値のある件数が 1 以下なら 50", () => {
    expect(percentileRanks([7])).toEqual([50]);
    expect(percentileRanks([null, 7])).toEqual([50, 50]);
    expect(percentileRanks([])).toEqual([]);
  });

  it("全部同じ値なら全員 50", () => {
    expect(percentileRanks([2, 2, 2])).toEqual([50, 50, 50]);
  });
});

describe("isSinceListingReturn", () => {
  it("5日は 6 本未満、20日は 21 本未満のとき、基準が上場初日の始値（上場来）", () => {
    expect(isSinceListingReturn(5, 5)).toBe(true);
    expect(isSinceListingReturn(6, 5)).toBe(false);
    expect(isSinceListingReturn(20, 20)).toBe(true);
    expect(isSinceListingReturn(21, 20)).toBe(false);
  });

  it("computeHotMetrics の基準の切り替わりと一致する", () => {
    // 6 本目から r5 は 1 本目の終値が基準（始値 50 が基準なら +100%、終値 100 が基準なら 0%）
    const five = computeHotMetrics(bars([100, 100, 100, 100, 100], undefined, 50))!;
    const six = computeHotMetrics(bars([100, 100, 100, 100, 100, 100], undefined, 50))!;
    expect(isSinceListingReturn(five.bars, 5)).toBe(true);
    expect(five.r5).toBeCloseTo(1, 10);
    expect(isSinceListingReturn(six.bars, 5)).toBe(false);
    expect(six.r5).toBeCloseTo(0, 10);
    expect(six.r20).toBeCloseTo(1, 10);
  });

  it("本数が分からない（古いデータ）なら false", () => {
    expect(isSinceListingReturn(undefined, 5)).toBe(false);
    expect(isSinceListingReturn(null, 20)).toBe(false);
  });
});

describe("hotReasons", () => {
  it("しきい値ちょうどでも出す（浮動小数の誤差を吸収）", () => {
    expect(hotReasons(metrics({ r5: 110 / 100 - 1 }))).toEqual(["5日 +10%"]);
    expect(hotReasons(metrics({ volRatio: 2 }))).toEqual(["出来高 2.0倍"]);
    expect(hotReasons(metrics({ highProx: 0.98 }))).toEqual(["上場来高値圏"]);
    expect(hotReasons(metrics({ r20: 0.2 }))).toEqual(["20日 +20%"]);
  });

  it("しきい値未満は出さない", () => {
    expect(
      hotReasons(metrics({ r5: 0.099, volRatio: 1.99, highProx: 0.979, r20: 0.199 })),
    ).toEqual([]);
  });

  it("最大3つ、r5 → 出来高 → 高値圏 → r20 の順", () => {
    expect(
      hotReasons(metrics({ r5: 0.234, volRatio: 3.16, highProx: 1, r20: 0.5 })),
    ).toEqual(["5日 +23%", "出来高 3.2倍", "上場来高値圏"]);
    expect(hotReasons(metrics({ r5: 0.15, r20: 0.3 }))).toEqual(["5日 +15%", "20日 +30%"]);
  });

  it("volRatio が null なら出来高のチップは出さない", () => {
    expect(hotReasons(metrics({ volRatio: null, highProx: 1 }))).toEqual(["上場来高値圏"]);
  });

  it("n=3: r5・r20 とも上場来で同じ値なので「上場来」は 1 つだけ", () => {
    expect(
      hotReasons(metrics({ bars: 3, r5: 0.3969, r20: 0.3969, volRatio: null, highProx: 1 })),
    ).toEqual(["上場来 +40%", "上場来高値圏"]);
    expect(hotReasons(metrics({ bars: 5, r5: 0.25, r20: 0.25 }))).toEqual(["上場来 +25%"]);
    // r5 だけが基準以上（r20 のしきい値は下回る）でも「5日」とは書かない
    expect(hotReasons(metrics({ bars: 3, r5: 0.15, r20: 0.15 }))).toEqual(["上場来 +15%"]);
  });

  it("n=10: r5 は 5日、r20 は上場来（値が違うので 2 つ出る。順序は r5 → 高値圏 → r20）", () => {
    expect(
      hotReasons(metrics({ bars: 10, r5: 0.21, r20: 0.45, volRatio: null, highProx: 1 })),
    ).toEqual(["5日 +21%", "上場来高値圏", "上場来 +45%"]);
  });

  it("n=30: 従来どおり 5日・20日", () => {
    expect(
      hotReasons(metrics({ bars: 30, r5: 0.11, r20: 0.69, volRatio: null, highProx: 1 })),
    ).toEqual(["5日 +11%", "上場来高値圏", "20日 +69%"]);
  });

  it("基準の切り替わり（5→6 本、20→21 本）", () => {
    expect(hotReasons(metrics({ bars: 5, r5: 0.2 }))).toEqual(["上場来 +20%"]);
    expect(hotReasons(metrics({ bars: 6, r5: 0.2 }))).toEqual(["5日 +20%"]);
    expect(hotReasons(metrics({ bars: 20, r20: 0.3 }))).toEqual(["上場来 +30%"]);
    expect(hotReasons(metrics({ bars: 21, r20: 0.3 }))).toEqual(["20日 +30%"]);
  });

  it("最大 3 つは維持（重複を除いたうえで数える）", () => {
    // 出来高のチップは n ≥ 25 でしか付かないので、n=30 で 4 つの条件を全部満たす
    expect(
      hotReasons(metrics({ bars: 30, r5: 0.3, r20: 0.5, volRatio: 3, highProx: 1 })),
    ).toEqual(["5日 +30%", "出来高 3.0倍", "上場来高値圏"]);
  });
});

describe("initialRatioOf", () => {
  const b = bars([500, 510], undefined, 450);

  it("初値 ÷ 公開価格（上場時の単位）", () => {
    expect(initialRatioOf({ offeringPrice: 1000, initialPrice: 1800, splitFactor: 2 }, b)).toBe(1.8);
  });

  it("分割銘柄で初値が無ければ、最初の足の始値 × 分割係数で上場時の単位に戻す", () => {
    // 1:2 分割後の調整済み始値 450 → 上場時の単位 900
    expect(initialRatioOf({ offeringPrice: 600, initialPrice: null, splitFactor: 2 }, b)).toBe(1.5);
    // 分割係数が無ければ 1
    expect(initialRatioOf({ offeringPrice: 600, initialPrice: null }, b)).toBe(0.75);
  });

  it("公開価格が無ければ null", () => {
    expect(initialRatioOf({ offeringPrice: null, initialPrice: 1000 }, b)).toBeNull();
    expect(initialRatioOf({ offeringPrice: 0, initialPrice: 1000 }, b)).toBeNull();
  });
});

// --- buildHotRanking ---

/** asOf=2026-09-29 で終わる n 本の日足。close は start から step ずつ、volume は一定。 */
function series(n: number, start: number, step: number, volume: number): QuotePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + step * i;
    return {
      date: addDaysIso("2026-09-29", i - (n - 1)),
      open: i === 0 ? start : start + step * (i - 1),
      high: close,
      low: Math.min(close, start + step * Math.max(0, i - 1)),
      close,
      volume,
    };
  });
}

function candidate(overrides: Partial<HotCandidate> & { code: string }): HotCandidate {
  return {
    name: `銘柄${overrides.code}`,
    listingDate: "2026-06-01",
    quotes: series(30, 1000, 10, 100_000),
    offeringPrice: 1000,
    initialPrice: 1100,
    splitFactor: 1,
    ...overrides,
  };
}

describe("buildHotRanking", () => {
  it("上昇の強い順に並び、asOf は最新の足の日付", () => {
    const r = buildHotRanking([
      candidate({ code: "1111", quotes: series(30, 1000, 1, 100_000) }),
      candidate({ code: "2222", quotes: series(30, 1000, 30, 100_000) }),
      candidate({ code: "3333", quotes: series(30, 1000, 10, 100_000) }),
    ]);
    expect(r.asOf).toBe("2026-09-29");
    expect(r.universe).toBe(3);
    expect(r.items.map((i) => i.code)).toEqual(["2222", "3333", "1111"]);
    expect(r.items[0].score).toBeGreaterThan(r.items[2].score);
    for (const item of r.items) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
    }
  });

  it("スコアは重みつきのパーセンタイル（2銘柄なら勝った指標の重みの合計）", () => {
    // A: r5・r20 が上、出来高倍率・高値比は同じ（出来高一定・終値が高値）→ 50
    const r = buildHotRanking([
      candidate({ code: "A", quotes: series(30, 1000, 20, 100_000) }),
      candidate({ code: "B", quotes: series(30, 1000, 5, 100_000) }),
    ]);
    const a = r.items.find((i) => i.code === "A")!;
    const b = r.items.find((i) => i.code === "B")!;
    expect(a.score).toBe(Math.round(0.35 * 100 + 0.25 * 100 + 0.25 * 50 + 0.15 * 50));
    expect(b.score).toBe(Math.round(0.25 * 50 + 0.15 * 50));
  });

  it("売買代金の足切り（3,000万円未満は対象外で、母数にも入れない）", () => {
    // 終値 1,100円前後 × 出来高 20,000株 ≒ 2,300万円 → 対象外
    const r = buildHotRanking([
      candidate({ code: "LOW", quotes: series(30, 1000, 5, 20_000) }),
      candidate({ code: "OK1", quotes: series(30, 1000, 10, 100_000) }),
      candidate({ code: "OK2", quotes: series(30, 1000, 1, 100_000) }),
    ]);
    expect(r.items.map((i) => i.code)).toEqual(["OK1", "OK2"]);
    expect(r.universe).toBe(2);
    expect(r.items.every((i) => i.turnover5 >= HOT_MIN_TURNOVER)).toBe(true);
  });

  it("上場から365日を超えた銘柄・上場日が asOf より後の銘柄は対象外", () => {
    const r = buildHotRanking([
      candidate({ code: "OLD", listingDate: "2025-09-28" }), // 366日前
      candidate({ code: "EDGE", listingDate: "2025-09-29" }), // ちょうど365日前
      candidate({ code: "FUT", listingDate: "2026-09-30" }),
    ]);
    expect(r.items.map((i) => i.code)).toEqual(["EDGE"]);
  });

  it("整形後2本未満（穴埋め行だけ・1本だけ）は対象外", () => {
    const filler = 55319998464;
    const r = buildHotRanking([
      candidate({
        code: "FILL",
        quotes: [
          { date: "2026-09-26", open: filler, high: filler, low: filler, close: filler, volume: 0 },
          { date: "2026-09-29", open: 1000, high: 1100, low: 990, close: 1050, volume: 100_000 },
        ],
      }),
      candidate({ code: "OK" }),
    ]);
    expect(r.items.map((i) => i.code)).toEqual(["OK"]);
  });

  it("重複した日付は1本にまとめる", () => {
    const quotes = series(3, 1000, 100, 100_000);
    const r = buildHotRanking([candidate({ code: "DUP", quotes: [...quotes, { ...quotes[2] }] })]);
    expect(r.items[0].r5).toBeCloseTo(1200 / 1000 - 1, 4);
  });

  it("asOf の日足が無い銘柄（売買停止など）は対象外", () => {
    const lagging = series(30, 1000, 10, 100_000).map((q) => ({ ...q, date: addDaysIso(q.date, -1) }));
    const r = buildHotRanking([candidate({ code: "LAG", quotes: lagging }), candidate({ code: "OK" })]);
    expect(r.asOf).toBe("2026-09-29");
    expect(r.items.map((i) => i.code)).toEqual(["OK"]);
  });

  it("スコアが同点なら証券コードの昇順", () => {
    const r = buildHotRanking([
      candidate({ code: "B" }),
      candidate({ code: "A" }),
      candidate({ code: "C" }),
    ]);
    expect(r.items.map((i) => i.code)).toEqual(["A", "B", "C"]);
    expect(new Set(r.items.map((i) => i.score)).size).toBe(1);
  });

  it("asOf を指定するとそれより後の足を使わない", () => {
    const r = buildHotRanking([candidate({ code: "A" })], { asOf: "2026-09-20" });
    expect(r.asOf).toBe("2026-09-20");
    // 2026-09-20 時点の終値は 1000 + 10×20
    expect(r.items[0].highProx).toBe(1);
    expect(r.items[0].r5).toBeCloseTo(1200 / 1150 - 1, 4);
  });

  it("分割銘柄の初値倍率は上場時の単位どうし（初値が無ければ始値×分割係数）", () => {
    const r = buildHotRanking([
      candidate({ code: "SPL", offeringPrice: 1500, initialPrice: null, splitFactor: 3 }),
    ]);
    // 調整済みの最初の始値 1000 × 3 = 3000 → 3000 / 1500
    expect(r.items[0].initialRatio).toBe(2);
  });

  it("理由チップが付く", () => {
    const r = buildHotRanking([candidate({ code: "A", quotes: series(30, 1000, 50, 100_000) })]);
    expect(r.items[0].reasons).toContain("上場来高値圏");
  });

  it("日足の本数 bars を各行に持つ", () => {
    const r = buildHotRanking([
      candidate({ code: "N3", quotes: series(3, 1000, 200, 100_000) }),
      candidate({ code: "N30" }),
    ]);
    expect(r.items.find((i) => i.code === "N3")?.bars).toBe(3);
    expect(r.items.find((i) => i.code === "N30")?.bars).toBe(30);
  });

  it("上場から日が浅い銘柄のチップは「上場来」で、重複しない（n=3・10・30）", () => {
    const r = buildHotRanking([
      candidate({ code: "N3", listingDate: "2026-09-27", quotes: series(3, 1000, 200, 100_000) }),
      candidate({ code: "N10", listingDate: "2026-09-20", quotes: series(10, 1000, 50, 100_000) }),
      candidate({ code: "N30", listingDate: "2026-08-31", quotes: series(30, 1000, 50, 100_000) }),
    ]);
    const reasons = (code: string) => r.items.find((i) => i.code === code)!.reasons;
    expect(reasons("N3")).toEqual(["上場来 +40%", "上場来高値圏"]);
    expect(reasons("N10")).toEqual(["5日 +21%", "上場来高値圏", "上場来 +45%"]);
    expect(reasons("N30")).toEqual(["5日 +11%", "上場来高値圏", "20日 +69%"]);
    // r5・r20 の値そのもの（スコアの入力）は今までと同じ定義
    expect(r.items.find((i) => i.code === "N3")).toMatchObject({ r5: 0.4, r20: 0.4 });
    expect(r.items.find((i) => i.code === "N10")).toMatchObject({ r5: 0.2083, r20: 0.45 });
  });

  it("件数の上限", () => {
    const many = Array.from({ length: 40 }, (_, i) => candidate({ code: `C${i}`, quotes: series(30, 1000, i, 100_000) }));
    expect(buildHotRanking(many).items).toHaveLength(30);
    expect(buildHotRanking(many, { limit: 5 }).items).toHaveLength(5);
  });

  it("対象が無ければ空", () => {
    expect(buildHotRanking([])).toEqual({ asOf: "", universe: 0, items: [] });
  });
});
