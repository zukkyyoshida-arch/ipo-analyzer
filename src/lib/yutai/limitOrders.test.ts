import { describe, expect, it } from "vitest";
import type { YutaiItem } from "./types";
import { expectedOutcome, fillRateOf, limitOrderPlan, limitOrderPlans } from "./limitOrders";

const rights = (o: Partial<NonNullable<YutaiItem["rights"]>> = {}): NonNullable<YutaiItem["rights"]> => ({
  years: [],
  n10: 10,
  win10: 6,
  hit10: 2,
  avgRet10: 0.01,
  avgHighRet10: 0.05,
  n5: 5,
  win5: 3,
  avgDraw10: -0.04,
  drawHits: [8, 6, 3, 1],
  ...o,
});
const item = (o: Partial<YutaiItem> = {}): Pick<YutaiItem, "price" | "rights" | "ma75" | "low1m"> => ({
  price: 1000,
  rights: rights(),
  ma75: 950,
  low1m: 920,
  ...o,
});
const stats = { years: [], avgRet10: 0.01 };

describe("limitOrderPlans", () => {
  it("成行・押し目・75日線・直近安値の順に 4 本", () => {
    const p = limitOrderPlans(item(), stats, 500_000, 5);
    expect(p.map((x) => x.id)).toEqual(["market", "dip", "ma75", "low1m"]);
    expect(p.map((x) => x.price)).toEqual([1000, 960, 950, 920]);
    expect(p[0].shares).toBe(100);
    expect(p[0].takeProfitPrice).toBe(1100);
    expect(p[1].takeProfitPrice).toBe(1056);
    expect(p[1].trailStopPrice).toBe(1008);
  });

  it("到達率: 成行は 1、下押し −4% は −5% ラインの 3/10、−8% 超は null", () => {
    const p = limitOrderPlans(item({ low1m: 900 }), stats, null, 5);
    expect(p[0].fillRate).toBe(1);
    expect(p[1].fillRate).toBeCloseTo(0.3); // 960 = −4% → −5% ライン
    expect(p[2].fillRate).toBeCloseTo(0.3); // 950 = −5%
    expect(p[3].fillRate).toBeNull(); // −10%
  });

  it("資金なしは株数・金額が null、価格がなければ空", () => {
    const p = limitOrderPlans(item(), stats, null, 5);
    expect(p[0].shares).toBeNull();
    expect(p[0].amountYen).toBeNull();
    expect(limitOrderPlans(item({ price: null }), stats, 1, 5)).toEqual([]);
  });

  it("75日線・直近安値が株価以上、avgDraw10 が null なら出さない。古いデータでも落ちない", () => {
    const p = limitOrderPlans(item({ ma75: 1100, low1m: 1000, rights: rights({ avgDraw10: null }) }), stats, 500_000, 5);
    expect(p.map((x) => x.id)).toEqual(["market"]);
    const q = limitOrderPlans({ price: 500, rights: null, ma75: undefined, low1m: undefined }, stats, 500_000, 5);
    expect(q.map((x) => x.id)).toEqual(["market"]);
    expect(q[0].fillRate).toBe(1);
  });
});

describe("fillRateOf / limitOrderPlan / expectedOutcome", () => {
  it("drawHits が無ければ null、指値が現在値以上なら 1", () => {
    expect(fillRateOf(1000, 970, rights({ drawHits: undefined }))).toBeNull();
    expect(fillRateOf(1000, 1000, rights())).toBe(1);
    expect(fillRateOf(1000, 980, rights())).toBeCloseTo(0.8);
  });

  it("自由入力の指値は 1 円に丸めて計算する。0 以下は null", () => {
    const p = limitOrderPlan(item(), "custom", "自分の指値", 949.6, 500_000, 5);
    expect(p?.price).toBe(950);
    expect(p?.shares).toBe(100);
    expect(limitOrderPlan(item(), "custom", "x", 0, 500_000, 5)).toBeNull();
  });

  it("期待利益と最悪ケース", () => {
    const s = { avgRet10: 0.02, years: [{ year: 2020, ret: 0.05 }, { year: 2021, ret: -0.08 }] };
    expect(expectedOutcome(s, 100_000)).toEqual({ avgYen: 2000, worstYen: -8000, worstYear: 2021 });
    expect(expectedOutcome({ avgRet10: null, years: [] }, 100_000)).toEqual({ avgYen: null, worstYen: null, worstYear: null });
    expect(expectedOutcome(s, 0).avgYen).toBeNull();
  });
});
