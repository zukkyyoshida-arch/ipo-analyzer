import { describe, expect, it } from "vitest";
import type { YutaiPick } from "@/lib/picks/yutai";
import { buildBasket } from "./basketPlan";

function pick(code: string, o: { sector?: string | null; price?: number; score?: number | null; rate?: number } = {}): YutaiPick {
  return {
    item: { code, name: `銘柄${code}`, price: o.price ?? 1000, sector: o.sector === undefined ? "食料品" : o.sector },
    upRate10: o.rate ?? 0.8,
    score: o.score === undefined ? 90 : o.score,
  } as unknown as YutaiPick;
}

const B = { budgetYen: 1_000_000, splitCount: 3 };

describe("buildBasket", () => {
  it("上位から分散数ぶんを選び、金額・使用率・加重勝率を出す", () => {
    const p = buildBasket(
      [pick("A", { sector: "食料品", rate: 1 }), pick("B", { sector: "銀行業", rate: 0.5 }), pick("C", { sector: "化学" }), pick("D")],
      B,
    );
    expect(p.entries.map((e) => e.code)).toEqual(["A", "B", "C"]);
    expect(p.entries[0]).toMatchObject({ shares: 300, amountYen: 300_000 });
    expect(p.totalYen).toBe(900_000);
    expect(p.usageRate).toBeCloseTo(0.9);
    expect(p.weightedWinRate).toBeCloseTo((1 + 0.5 + 0.8) / 3);
    expect(p.warnings).toEqual([]);
    expect(p.shortfall).toBe(0);
  });

  it("データ不足・枠で 100 株買えない銘柄は飛ばして次点を入れる", () => {
    const p = buildBasket(
      [pick("A", { score: null }), pick("B", { price: 5000 }), pick("C", { sector: "銀行業" }), pick("D", { sector: "化学" }), pick("E", { sector: "陸運業" })],
      B,
    );
    expect(p.entries.map((e) => e.code)).toEqual(["C", "D", "E"]);
  });

  it("足りないときは shortfall、株価なしも飛ばす", () => {
    const p = buildBasket([pick("A", { price: 0 }), pick("B")], B);
    expect(p.entries.map((e) => e.code)).toEqual(["B"]);
    expect(p.shortfall).toBe(2);
  });

  it("同じ業種が 3 銘柄で注意し、同じ業種以外の次点を差し替え候補にする", () => {
    const picks = [pick("A"), pick("B"), pick("C"), pick("D"), pick("E", { sector: "銀行業" }), pick("F", { sector: "化学" })];
    const p = buildBasket(picks, B);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatchObject({ sector: "食料品", count: 3, dropCode: "C" });
    expect(p.warnings[0].alt?.code).toBe("E");
    expect(p.sectors).toEqual([{ sector: "食料品", count: 3 }]);
  });

  it("replaceCode で偏った業種の最下位と入れ替わり、注意が消える", () => {
    const picks = [pick("A"), pick("B"), pick("C"), pick("D"), pick("E", { sector: "銀行業" })];
    const p = buildBasket(picks, { ...B, replaceCode: "E" });
    expect(p.replaced).toBe(true);
    expect(p.entries.map((e) => e.code)).toEqual(["A", "B", "E"]);
    expect(p.warnings).toEqual([]);
  });

  it("偏りが無いときの replaceCode は無視、業種不明は注意しない", () => {
    const p = buildBasket([pick("A", { sector: null }), pick("B", { sector: null }), pick("C", { sector: null }), pick("D", { sector: "銀行業" })], {
      ...B,
      replaceCode: "D",
    });
    expect(p.replaced).toBe(false);
    expect(p.warnings).toEqual([]);
    expect(p.entries.map((e) => e.code)).toEqual(["A", "B", "C"]);
  });
});
