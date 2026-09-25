import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";
import model from "./bb-model.json";
import { MAX_MISSING_FEATURES, estimateBreakEvenProbability } from "./bbProbability";

// bb.test.ts と同じ形のベース銘柄。points は
// 吸収50億=0 / OR25%=0 / 主幹事15%=0 / レンジ内=0 / VC20%×ロック中=0 / 売出44.4%=0 / 幹事団1社=+2
function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "2026-07-24",
    bbPeriod: { start: "2026-07-07", end: "2026-07-11" },
    allotmentDate: "2026-07-15",
    purchasePeriod: { start: "2026-07-16", end: "2026-07-22" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 500000,
    saleShares: 400000,
    overAllotment: 100000,
    absorptionAmount: 50,
    offeringRatio: 25,
    marketCap: 100,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券"],
    financials: {
      revenue: 2000,
      revenueGrowth: 20,
      operatingProfit: 200,
      isProfitable: true,
    },
    per: 30,
    psr: 4,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: null,
    status: "upcoming",
    similarIpoCodes: [],
    ...overrides,
  };
}

const stat: UnderwriterBreakEvenStat = {
  underwriter: "SBI証券",
  sampleCount: 10,
  breakEvenRate: 15,
  meanReturn: 30,
  lowSample: false,
};

/** テスト側で係数 JSON から独立に確率を計算する。 */
function expectedProbability(points: Record<string, number>): number {
  let z = model.intercept;
  for (const f of model.features) {
    z += f.coef * (((points[f.key] ?? 0) - f.mean) / f.sd);
  }
  return 1 / (1 + Math.exp(-z));
}

describe("bb-model.json", () => {
  it("学習期間・母数・検証 AUC・特徴量の平均/標準偏差を持つ", () => {
    expect(model.trainedThrough).toBe("2023-12-31");
    expect(model.sampleCount).toBeGreaterThan(500);
    expect(model.validation.auc).toBeGreaterThanOrEqual(0.65);
    for (const f of model.features) {
      expect(Number.isFinite(f.coef)).toBe(true);
      expect(f.sd).toBeGreaterThan(0);
    }
  });
});

describe("estimateBreakEvenProbability", () => {
  it("係数 JSON どおりの確率を返す", () => {
    const r = estimateBreakEvenProbability(baseIpo(), {
      underwriterStat: stat,
      recentIpoAvgReturn: 60, // 0点
      sameWeekListings: 5, // 0点
    });
    expect(r).not.toBeNull();
    const expected = expectedProbability({
      absorption: 0,
      offeringRatioBb: 0,
      underwriterTrack: 0,
      priceRangePosition: 0,
      vcLockup: 0,
      saleRatio: 0,
      underwriterCount: 2,
      sameWeekListings: 0,
      recentIpoSentiment: 0,
    });
    expect(r?.probability).toBeCloseTo(expected, 10);
    expect(r?.missingCount).toBe(0);
    expect(r?.sampleCount).toBe(model.sampleCount);
    expect(r?.trainedFrom).toBe(model.trainedFrom);
    expect(r?.trainedThrough).toBe(model.trainedThrough);
    expect(r?.auc).toBe(model.validation.auc);
    expect(r?.validationCount).toBe(model.validation.sampleCount);
  });

  it("需給が軽い銘柄ほど確率が低い（吸収金額・仮条件・直近IPOの向き）", () => {
    const light = estimateBreakEvenProbability(
      baseIpo({ absorptionAmount: 5, priceRange: { low: 1100, high: 1200 } }),
      { underwriterStat: stat, recentIpoAvgReturn: 150, sameWeekListings: 1 },
    );
    const heavy = estimateBreakEvenProbability(
      baseIpo({ absorptionAmount: 600, priceRange: { low: 800, high: 900 } }),
      { underwriterStat: stat, recentIpoAvgReturn: 0, sameWeekListings: 10 },
    );
    expect(light).not.toBeNull();
    expect(heavy).not.toBeNull();
    expect(light!.probability).toBeLessThan(heavy!.probability);
    expect(light!.probability).toBeGreaterThan(0);
    expect(heavy!.probability).toBeLessThan(1);
  });

  it("吸収金額が未取得なら null", () => {
    expect(
      estimateBreakEvenProbability(baseIpo({ absorptionAmount: 0 }), {
        underwriterStat: stat,
        recentIpoAvgReturn: 60,
        sameWeekListings: 3,
      }),
    ).toBeNull();
  });

  it(`未取得が ${MAX_MISSING_FEATURES} 項目までは中立扱いで算出し、超えたら null`, () => {
    // context なし → 主幹事実績・同週上場件数・直近IPO の3項目が未取得
    expect(estimateBreakEvenProbability(baseIpo())).toBeNull();
    // 主幹事実績だけ渡す → 2項目未取得
    const r = estimateBreakEvenProbability(baseIpo(), { underwriterStat: stat });
    expect(r).not.toBeNull();
    expect(r?.missingCount).toBe(2);
  });

  it("主幹事の母数5件未満は 0 点だが未取得には数えない", () => {
    const r = estimateBreakEvenProbability(baseIpo(), {
      underwriterStat: { ...stat, sampleCount: 3, breakEvenRate: 0, lowSample: true },
      recentIpoAvgReturn: 60,
      sameWeekListings: 5,
    });
    expect(r?.missingCount).toBe(0);
  });
});
