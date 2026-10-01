import { describe, expect, it } from "vitest";
import { normalizeBudgetMan, normalizeSplitCount, yutaiEntryPlan } from "./entry";

describe("yutaiEntryPlan", () => {
  it("枠 = 資金 ÷ 分散数、株数は 100 株単位で切り捨て、利確・逆指値の目安", () => {
    // 100 万円を 5 分散 → 枠 20 万円。株価 800 円なら 200 株 = 16 万円
    const p = yutaiEntryPlan(800, 1_000_000, 5)!;
    expect(p.frameYen).toBe(200_000);
    expect(p.shares).toBe(200);
    expect(p.amountYen).toBe(160_000);
    expect(p.overFrame).toBe(false);
    expect(p.takeProfitPrice).toBe(880);
    expect(p.profitYen).toBe(16_000);
    expect(p.trailTriggerPrice).toBe(864);
    expect(p.trailStopPrice).toBe(840);
  });

  it("4 分散なら枠が大きくなる", () => {
    expect(yutaiEntryPlan(800, 1_000_000, 4)!.shares).toBe(300);
  });

  it("最低投資額が枠を超えると 0 株で枠超え", () => {
    const p = yutaiEntryPlan(3_000, 1_000_000, 5)!;
    expect(p.shares).toBe(0);
    expect(p.amountYen).toBe(0);
    expect(p.profitYen).toBe(0);
    expect(p.overFrame).toBe(true);
    expect(p.takeProfitPrice).toBe(3_300);
  });

  it("小数の株価は四捨五入", () => {
    const p = yutaiEntryPlan(1234.5, 500_000, 4)!;
    expect(p.shares).toBe(100);
    expect(p.amountYen).toBe(123_450);
    expect(p.takeProfitPrice).toBe(1358);
  });

  it("株価が無い・資金や分散数が正でなければ null", () => {
    expect(yutaiEntryPlan(null, 1_000_000, 5)).toBeNull();
    expect(yutaiEntryPlan(0, 1_000_000, 5)).toBeNull();
    expect(yutaiEntryPlan(800, 0, 5)).toBeNull();
    expect(yutaiEntryPlan(800, 1_000_000, 0)).toBeNull();
  });
});

describe("normalizeBudgetMan / normalizeSplitCount", () => {
  it("選択肢に無い値は一番近い選択肢へ、空や不正は指定なし", () => {
    expect(normalizeBudgetMan("50")).toBe(50);
    expect(normalizeBudgetMan(100)).toBe(100);
    expect(normalizeBudgetMan("70")).toBe(50); // 50 と 100 の間で 50 が近い
    expect(normalizeBudgetMan("80")).toBe(100);
    expect(normalizeBudgetMan("25")).toBe(20); // 同じ近さなら小さい方
    expect(normalizeBudgetMan("3")).toBe(10);
    expect(normalizeBudgetMan("10000")).toBe(500);
    expect(normalizeBudgetMan("")).toBeNull();
    expect(normalizeBudgetMan("abc")).toBeNull();
    expect(normalizeBudgetMan("-5")).toBeNull();
    expect(normalizeBudgetMan(null)).toBeNull();
  });

  it("分散数は 1〜5、それ以外は 5", () => {
    expect(normalizeSplitCount("1")).toBe(1);
    expect(normalizeSplitCount("4")).toBe(4);
    expect(normalizeSplitCount(5)).toBe(5);
    expect(normalizeSplitCount("3")).toBe(3);
    expect(normalizeSplitCount("6")).toBe(5);
    expect(normalizeSplitCount("0")).toBe(5);
    expect(normalizeSplitCount(undefined)).toBe(5);
  });
});
