import { describe, expect, it } from "vitest";
import type { YutaiItem, YutaiMonth } from "@/lib/yutai/types";
import { lastRangeOf, pricePos12, rankYutai, sortYutai, type YutaiPick } from "./yutai";

function item(code: string, o: Partial<YutaiItem> = {}): YutaiItem {
  return {
    code,
    name: `銘柄${code}`,
    minInvest: 300_000,
    yutaiYield: 3,
    divYield: 1,
    totalYield: 4,
    rightsMonths: [12],
    detailUrl: `https://example.com/${code}`,
    candles: [],
    up10: 5,
    n10: 10,
    up5: 3,
    n5: 5,
    avgRet10: 0.01,
    avgHighRet10: 0.05,
    price: 1000,
    high12: 1100,
    low12: 900,
    ...o,
  };
}

function file(items: YutaiItem[]): YutaiMonth {
  return { month: 12, prevMonth: 11, listUrl: "", listedCount: items.length, items };
}

describe("rankYutai", () => {
  it("直近5年の陽線数 → 10年の陽線率 → 陽線数 → 平均騰落率の降順", () => {
    const f = file([
      item("A", { up10: 7, n10: 10, up5: 3 }),
      item("B", { up10: 6, n10: 10, up5: 5 }),
      item("C", { up10: 8, n10: 10, up5: 4 }),
      item("D", { up10: 7, n10: 10, up5: 4 }),
      item("E", { up10: 7, n10: 10, up5: 4, avgRet10: 0.05 }),
      item("F", { up10: 4, n10: 5, up5: 4, n5: 5 }), // 10 年 80%・陽線数 4（C の 80% と同率で陽線数が下）
    ]);
    expect(rankYutai(f).map((p) => p.item.code)).toEqual(["B", "C", "F", "E", "D", "A"]);
  });

  it("tier: 強は直近5年 4/5 以上かつ10年 8 本以上で 70%、良は直近5年 3/4 以上かつ 60%", () => {
    const f = file([
      item("S", { up10: 8, n10: 10, up5: 4, n5: 5 }),
      item("S2", { up10: 8, n10: 10, up5: 3, n5: 5 }), // 直近5年が足りず good
      item("G", { up10: 6, n10: 10, up5: 3, n5: 4 }),
      item("O", { up10: 5, n10: 10, up5: 3, n5: 5 }),
      item("SMALL", { up10: 4, n10: 4, up5: 4, n5: 4 }), // 100% でも 5 本未満は other
      item("N7", { up10: 5, n10: 7, up5: 4, n5: 5 }), // 71% だが n10 が 8 未満 → good
    ]);
    const t = Object.fromEntries(rankYutai(f).map((p) => [p.item.code, p.tier]));
    expect(t).toEqual({ S: "strong", S2: "good", G: "good", O: "other", SMALL: "other", N7: "good" });
  });

  it("n10 が小さいと注意タグが付き、上位に勝手に来ても other のまま", () => {
    const small = rankYutai(file([item("SMALL", { up10: 4, n10: 4 })]))[0];
    expect(small.upRate10).toBe(1);
    expect(small.reasons.map((r) => r.id)).toContain("short");
    expect(small.reasons.map((r) => r.id)).not.toContain("up10");
  });

  it("株価位置: 高値圏・安値圏のタグ、レンジが無ければ null", () => {
    expect(pricePos12(item("X", { price: 1090, high12: 1100, low12: 900 }))).toBeCloseTo(0.95);
    expect(pricePos12(item("X", { high12: 900, low12: 900 }))).toBeNull();
    expect(pricePos12(item("X", { price: null }))).toBeNull();
    const [hi] = rankYutai(file([item("H", { price: 1090 })]));
    expect(hi.reasons.find((r) => r.id === "high")?.text).toBe("年高値圏（株価位置 95%）");
    const [lo] = rankYutai(file([item("L", { price: 910 })]));
    expect(lo.reasons.map((r) => r.id)).toContain("low");
  });

  it("前月平均・直近5年のタグ", () => {
    const [p] = rankYutai(file([item("A", { up10: 8, n10: 10, up5: 4, n5: 5, avgRet10: 0.032 })]));
    const texts = p.reasons.map((r) => r.text);
    expect(texts).toContain("10年で8勝");
    expect(texts).toContain("直近5年 4勝");
    expect(texts).toContain("前月平均 +3.2%");
  });

  it("月が null のときは空", () => {
    expect(rankYutai(null)).toEqual([]);
  });
});

describe("lastRange", () => {
  const c = (year: number, high: number | null, low: number | null) => ({ year, open: 100, close: 100, high, low });
  const pickOf = (it: YutaiItem): YutaiPick => rankYutai(file([it]))[0];

  it("最後の1本の高値/安値-1", () => {
    const p = pickOf(item("A", { candles: [c(2024, 200, 50), c(2025, 125, 100)] }));
    expect(p.lastRange).toBeCloseTo(0.25);
  });
  it("high が null・low が 0 以下・月足なしは null", () => {
    expect(pickOf(item("A", { candles: [c(2025, null, 100)] })).lastRange).toBeNull();
    expect(lastRangeOf([c(2025, 100, 0)])).toBeNull();
    expect(pickOf(item("A", { candles: [] })).lastRange).toBeNull();
  });
});

describe("sortYutai", () => {
  const c = (high: number | null, low: number | null) => ({ year: 2025, open: 100, close: 100, high, low });
  const picks = () =>
    rankYutai(
      file([
        item("A", { up5: 5, up10: 9, n10: 10, minInvest: 500_000, candles: [c(110, 100)] }),
        item("B", { up5: 4, up10: 8, n10: 10, minInvest: 100_000, candles: [c(150, 100)] }),
        item("C", { up5: 3, up10: 7, n10: 10, minInvest: null, candles: [] }),
        item("D", { up5: 4, up10: 4, n10: 4, n5: 4, minInvest: 300_000, candles: [c(130, 100)] }),
      ]),
    );
  const codes = (ps: YutaiPick[]) => ps.map((p) => p.item.code);

  it("wins: 直近5年の勝利数の降順", () => {
    expect(codes(sortYutai(picks(), "wins"))).toEqual(["A", "D", "B", "C"]);
  });
  it("rate: 勝率の降順で、n10 不足は後ろ", () => {
    expect(codes(sortYutai(picks(), "rate"))).toEqual(["A", "B", "C", "D"]);
  });
  it("range: 勝率×前年の値幅の降順。月足不足は後ろ、値幅 null は最後", () => {
    // A: 0.9×0.10=0.09、B: 0.8×0.50=0.40、D: 1.0×0.30=0.30 だが n10 不足、C: 値幅なし
    expect(codes(sortYutai(picks(), "range"))).toEqual(["B", "A", "D", "C"]);
    expect(picks().find((p) => p.item.code === "B")?.rangeScore).toBeCloseTo(0.4);
  });
  it("minInvest: 昇順、null は最後", () => {
    expect(codes(sortYutai(picks(), "minInvest"))).toEqual(["B", "D", "A", "C"]);
  });
  it("元の配列を破壊しない", () => {
    const p = picks();
    const before = codes(p);
    sortYutai(p, "minInvest");
    expect(codes(p)).toEqual(before);
  });
});
