import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import {
  ABSORPTION_BAND_LABELS,
  OFFERING_RATIO_BAND_LABELS,
  classifyAbsorptionBand,
  classifyOfferingRatioBand,
  marketStats,
  median,
  offeringRatioBandStats,
  outcomeDistributionByAbsorptionBand,
  underwriterBreakEvenStat,
  underwriterBreakEvenStats,
} from "./index";

// テスト用のベース銘柄。scoring/scoring.test.ts のスタイルに合わせる。
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
    offeringPrice: 1000,
    priceRangePosition: null,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    absorptionAmount: 20,
    offeringRatio: 20,
    marketCap: 100,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
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

/** 上場済み銘柄。初値は公開価格1000円に対する騰落率（%）から作る。 */
function listed(code: string, returnPct: number, overrides: Partial<Ipo> = {}): Ipo {
  return baseIpo({
    code,
    name: `銘柄${code}`,
    status: "listed",
    offeringPrice: 1000,
    initialPrice: 1000 + returnPct * 10,
    ...overrides,
  });
}

describe("classifyAbsorptionBand", () => {
  it("境界値の両側を正しく分類する（10/30/100億円）", () => {
    expect(classifyAbsorptionBand(0.5)).toBe("under10");
    expect(classifyAbsorptionBand(9.9)).toBe("under10");
    expect(classifyAbsorptionBand(10)).toBe("10to30");
    expect(classifyAbsorptionBand(29.9)).toBe("10to30");
    expect(classifyAbsorptionBand(30)).toBe("30to100");
    expect(classifyAbsorptionBand(99.9)).toBe("30to100");
    expect(classifyAbsorptionBand(100)).toBe("over100");
    expect(classifyAbsorptionBand(500)).toBe("over100");
  });

  it("全帯にラベルがある", () => {
    expect(Object.keys(ABSORPTION_BAND_LABELS)).toHaveLength(4);
    expect(ABSORPTION_BAND_LABELS.over100).toBe("100億円以上");
  });
});

describe("classifyOfferingRatioBand", () => {
  it("境界値の両側を正しく分類する（10/30/50%）", () => {
    expect(classifyOfferingRatioBand(9.9)).toBe("under10");
    expect(classifyOfferingRatioBand(10)).toBe("10to30");
    expect(classifyOfferingRatioBand(29.9)).toBe("10to30");
    expect(classifyOfferingRatioBand(30)).toBe("30to50");
    expect(classifyOfferingRatioBand(49.9)).toBe("30to50");
    expect(classifyOfferingRatioBand(50)).toBe("over50");
  });

  it("全帯にラベルがある", () => {
    expect(Object.keys(OFFERING_RATIO_BAND_LABELS)).toHaveLength(4);
  });
});

describe("median", () => {
  it("奇数件は中央の値", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
  it("偶数件は中央2件の平均", () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });
  it("空配列は null・元配列を破壊しない", () => {
    expect(median([])).toBeNull();
    const src = [3, 1, 2];
    median(src);
    expect(src).toEqual([3, 1, 2]);
  });
});

describe("outcomeDistributionByAbsorptionBand", () => {
  const target = baseIpo({ code: "T", absorptionAmount: 20, market: "グロース" });

  it("母数0なら null を返し例外を投げない", () => {
    const result = outcomeDistributionByAbsorptionBand([], target);
    expect(result).toEqual({
      sampleCount: 0,
      winRate: null,
      medianReturnRate: null,
      meanReturnRate: null,
      samples: [],
    });
  });

  it("同じ帯・同じ市場の上場済みだけを対象にし、target自身を除外する", () => {
    const all = [
      target,
      listed("T", 50, { absorptionAmount: 20 }), // 同一コード（自身）は除外
      listed("A", 100, { absorptionAmount: 15 }),
      listed("B", -10, { absorptionAmount: 25 }),
      listed("C", 40, { absorptionAmount: 12 }),
      listed("D", 80, { absorptionAmount: 5 }), // 帯違い
      listed("E", 80, { absorptionAmount: 20, market: "プライム" }), // 市場違い
      baseIpo({ code: "F", absorptionAmount: 20 }), // 未上場
      listed("G", 80, { absorptionAmount: 20, initialPrice: null }), // 初値なし
      listed("H", 80, { absorptionAmount: 20, offeringPrice: null }), // 公開価格なし
    ];
    const result = outcomeDistributionByAbsorptionBand(all, target);
    expect(result.sampleCount).toBe(3);
    expect(result.medianReturnRate).toBeCloseTo(40);
    expect(result.meanReturnRate).toBeCloseTo(130 / 3);
    expect(result.winRate).toBeCloseTo((2 / 3) * 100);
    expect(result.samples.map((s) => s.code).sort()).toEqual(["A", "B", "C"]);
  });

  it("母数ありで全件公募割れなら winRate は 0（null と区別）", () => {
    const all = [listed("A", -10), listed("B", 0)];
    const result = outcomeDistributionByAbsorptionBand(all, target);
    expect(result.sampleCount).toBe(2);
    expect(result.winRate).toBe(0);
    expect(result.medianReturnRate).toBeCloseTo(-5);
  });

  it("samples は上場日の新しい順で最大10件", () => {
    const all = Array.from({ length: 12 }, (_, i) =>
      listed(`S${i}`, i, { listingDate: `2025-${String(i + 1).padStart(2, "0")}-01` }),
    );
    const result = outcomeDistributionByAbsorptionBand(all, target);
    expect(result.sampleCount).toBe(12);
    expect(result.samples).toHaveLength(10);
    expect(result.samples[0].code).toBe("S11");
    expect(result.samples[9].code).toBe("S2");
    expect(result.samples[0].returnRate).toBeCloseTo(11);
  });

  it("吸収金額が未取得（0）の銘柄は target・母集団とも対象外", () => {
    const all = [listed("A", 10, { absorptionAmount: 0 }), listed("B", 10, { absorptionAmount: 5 })];
    expect(outcomeDistributionByAbsorptionBand(all, baseIpo({ absorptionAmount: 0 })).sampleCount).toBe(0);
    expect(outcomeDistributionByAbsorptionBand(all, baseIpo({ code: "X", absorptionAmount: 3 })).sampleCount).toBe(1);
  });
});

describe("underwriterBreakEvenStats", () => {
  const all = [
    listed("A1", -10, { leadUnderwriter: "A証券" }),
    listed("A2", 20, { leadUnderwriter: "A証券" }),
    listed("A3", 30, { leadUnderwriter: "A証券" }),
    listed("A4", -20, { leadUnderwriter: "A証券" }),
    listed("A5", 0, { leadUnderwriter: "A証券" }),
    listed("B1", 50, { leadUnderwriter: "B証券" }),
    listed("B2", -50, { leadUnderwriter: "B証券" }),
    listed("C1", 10, { leadUnderwriter: "C証券" }),
    baseIpo({ code: "U", leadUnderwriter: "C証券" }), // 未上場は対象外
  ];

  it("既定 minSample=2 で母数1の主幹事を除外し、母数の多い順に並べる", () => {
    const stats = underwriterBreakEvenStats(all);
    expect(stats.map((s) => s.underwriter)).toEqual(["A証券", "B証券"]);
    const a = stats[0];
    expect(a.sampleCount).toBe(5);
    expect(a.breakEvenRate).toBeCloseTo(40); // 初値=公開価格は公募割れに含めない
    expect(a.meanReturn).toBeCloseTo(4);
    expect(a.lowSample).toBe(false);
    expect(stats[1].lowSample).toBe(true);
    expect(stats[1].breakEvenRate).toBeCloseTo(50);
  });

  it("minSample を指定できる", () => {
    expect(underwriterBreakEvenStats(all, 1)).toHaveLength(3);
    expect(underwriterBreakEvenStats(all, 6)).toHaveLength(0);
    expect(underwriterBreakEvenStats([])).toEqual([]);
  });

  it("単一主幹事の統計を返し、母数0なら null", () => {
    const c = underwriterBreakEvenStat(all, "C証券");
    expect(c).toEqual({
      underwriter: "C証券",
      sampleCount: 1,
      breakEvenRate: 0,
      meanReturn: 10,
      lowSample: true,
    });
    expect(underwriterBreakEvenStat(all, "Z証券")).toBeNull();
    expect(underwriterBreakEvenStat([], "A証券")).toBeNull();
  });
});

describe("offeringRatioBandStats", () => {
  it("4帯を固定順で返し、母数0の帯は null、OR未取得（0）は除外", () => {
    const all = [
      listed("A", 60, { offeringRatio: 5 }),
      listed("B", 20, { offeringRatio: 9.9 }),
      listed("C", -5, { offeringRatio: 50 }),
      listed("D", 99, { offeringRatio: 0 }),
    ];
    const stats = offeringRatioBandStats(all);
    expect(stats.map((s) => s.band)).toEqual(["under10", "10to30", "30to50", "over50"]);
    expect(stats[0]).toEqual({ band: "under10", sampleCount: 2, medianReturnRate: 40, winRate: 100 });
    expect(stats[1]).toEqual({ band: "10to30", sampleCount: 0, medianReturnRate: null, winRate: null });
    expect(stats[3].sampleCount).toBe(1);
    expect(stats[3].winRate).toBe(0);
  });
});

describe("marketStats", () => {
  it("3市場を固定順で返し、母数0の市場は null", () => {
    const all = [
      listed("A", 10, { market: "グロース" }),
      listed("B", 30, { market: "グロース" }),
      listed("C", -10, { market: "プライム" }),
    ];
    const stats = marketStats(all);
    expect(stats.map((s) => s.market)).toEqual(["グロース", "スタンダード", "プライム"]);
    expect(stats[0]).toEqual({ market: "グロース", sampleCount: 2, winRate: 100, medianReturnRate: 20 });
    expect(stats[1]).toEqual({ market: "スタンダード", sampleCount: 0, winRate: null, medianReturnRate: null });
    expect(stats[2].winRate).toBe(0);
  });
});
