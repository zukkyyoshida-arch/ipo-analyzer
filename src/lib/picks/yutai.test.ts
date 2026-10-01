import { describe, expect, it } from "vitest";
import type { YutaiItem, YutaiMonth } from "@/lib/yutai/types";
import {
  lastRangeOf,
  parseYutaiSortKey,
  percentileRanks,
  pricePos12,
  rankYutai,
  sortYutai,
  type YutaiPick,
} from "./yutai";

function item(code: string, o: Partial<YutaiItem> = {}): YutaiItem {
  return {
    code,
    name: `銘柄${code}`,
    minInvest: 300_000,
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
  return { month: 12, prevMonth: 11, listUrl: "", listedCount: items.length, items, baseline: null };
}

const codes = (ps: YutaiPick[]) => ps.map((p) => p.item.code);

describe("percentileRanks", () => {
  it("昇順の順位を 0〜1 にし、同値は平均、null は最下位", () => {
    expect(percentileRanks([3, 1, 2])).toEqual([1, 0, 0.5]);
    expect(percentileRanks([1, 1, 2])).toEqual([0.25, 0.25, 1]);
    expect(percentileRanks([null, 5])).toEqual([0, 1]);
    expect(percentileRanks([7])).toEqual([1]);
    expect(percentileRanks([])).toEqual([]);
  });
});

describe("rankYutai（総合評価）", () => {
  it("4 指標のパーセンタイルの平均で並べ、0〜100 の整数にする", () => {
    const f = file([
      // すべて最上位 → 100
      item("A", { up10: 9, n10: 10, up5: 5, avgRet10: 0.05, avgHighRet10: 0.1 }),
      // すべて最下位 → 0
      item("B", { up10: 3, n10: 10, up5: 1, avgRet10: -0.02, avgHighRet10: 0.01 }),
      // すべて真ん中 → 50
      item("C", { up10: 6, n10: 10, up5: 3, avgRet10: 0.01, avgHighRet10: 0.05 }),
    ]);
    const r = rankYutai(f);
    expect(codes(r)).toEqual(["A", "C", "B"]);
    expect(r.map((p) => p.score)).toEqual([100, 50, 0]);
  });

  it("月足 5 本未満はデータ不足: 総合点なしで常に最後、母集団にも入れない", () => {
    const f = file([
      item("SMALL", { up10: 4, n10: 4, up5: 4, n5: 4, avgRet10: 0.2, avgHighRet10: 0.3 }),
      item("A", { up10: 7, n10: 10 }),
      item("B", { up10: 6, n10: 10 }),
    ]);
    const r = rankYutai(f);
    expect(codes(r)).toEqual(["A", "B", "SMALL"]);
    expect(r[2].score).toBeNull();
    expect(r[2].reasons.map((x) => x.id)).toContain("short");
    expect(r[2].reasons.map((x) => x.id)).not.toContain("up10");
    // SMALL を除いた 2 社で順位を付ける（A は勝率で上、ほかは同値）
    expect(r[0].score).toBe(63);
    expect(r[1].score).toBe(38);
  });

  it("総合点が同じなら 10 年勝率 → 前月平均で決める", () => {
    // X と Y は 10 年勝率と前月平均の順位が入れ替わり、合計が同じ
    const f = file([
      item("X", { up10: 8, n10: 10, avgRet10: 0.01 }),
      item("Y", { up10: 7, n10: 10, avgRet10: 0.02 }),
    ]);
    const r = rankYutai(f);
    expect(r[0].scoreRaw).toBe(r[1].scoreRaw);
    expect(codes(r)).toEqual(["X", "Y"]);
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

describe("sortYutai（指標別）", () => {
  const picks = () =>
    rankYutai(
      file([
        item("A", { up5: 5, up10: 9, n10: 10, avgRet10: 0.01, avgHighRet10: 0.04, minInvest: 500_000 }),
        item("B", { up5: 4, up10: 8, n10: 10, avgRet10: 0.03, avgHighRet10: 0.09, minInvest: 100_000 }),
        item("C", { up5: 3, up10: 7, n10: 10, avgRet10: null, avgHighRet10: 0.06, minInvest: null }),
        item("D", { up5: 4, up10: 4, n10: 4, n5: 4, avgRet10: 0.2, avgHighRet10: 0.3, minInvest: 300_000 }),
      ]),
    );

  it("rate10: 10 年の勝率の降順で、データ不足は後ろ", () => {
    expect(codes(sortYutai(picks(), "rate10"))).toEqual(["A", "B", "C", "D"]);
  });
  it("wins5: 直近 5 年の勝利数の降順で、データ不足は後ろ", () => {
    expect(codes(sortYutai(picks(), "wins5"))).toEqual(["A", "B", "C", "D"]);
  });
  it("avgRet: 前月平均の降順、null は後ろ（データ不足はさらに後ろ）", () => {
    expect(codes(sortYutai(picks(), "avgRet"))).toEqual(["B", "A", "C", "D"]);
  });
  it("highRet: 最大上昇の平均の降順", () => {
    expect(codes(sortYutai(picks(), "highRet"))).toEqual(["B", "C", "A", "D"]);
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
  it("知らない並び順（以前の値）は総合", () => {
    expect(parseYutaiSortKey("wins")).toBe("score");
    expect(parseYutaiSortKey("highRet")).toBe("highRet");
    expect(parseYutaiSortKey(undefined)).toBe("score");
  });
});
