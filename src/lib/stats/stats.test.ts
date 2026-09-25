import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { HistoricalIpo } from "@/types/history";
import {
  ABSORPTION_BAND_LABELS,
  OFFERING_RATIO_BAND_LABELS,
  classifyAbsorptionBand,
  classifyOfferingRatioBand,
  filterByPeriod,
  marketStats,
  outcomeByPeriod,
  outcomeReferenceDate,
  periodStartDate,
  median,
  offeringRatioBandStats,
  outcomeDistributionByAbsorptionBand,
  underwriterBreakEvenStat,
  underwriterBreakEvenStats,
} from "./index";
import { combineOutcomeSources, historicalToOutcomeSource, ipoToOutcomeSource } from "./history";

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

/** 履歴（2015〜2023）の銘柄。公開価格1000円・騰落率（%）から初値を作る。 */
function hist(code: string, returnPct: number | null, overrides: Partial<HistoricalIpo> = {}): HistoricalIpo {
  return {
    code,
    name: `履歴${code}`,
    market: "グロース",
    listingDate: "2020-06-01",
    offeringPrice: 1000,
    initialPrice: returnPct === null ? null : 1000 + returnPct * 10,
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    absorptionAmount: 20,
    marketCap: 100,
    offeringRatio: 20,
    saleRatio: 30,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    leadUnderwriter: "SBI証券",
    underwriterCount: 5,
    vcRatio: null,
    lockupDays: null,
    lockupHasPriceRelease: null,
    lockupCoverage: null,
    revenueGrowth: null,
    isProfitable: null,
    sourceUrl: "https://example.com/",
    fetchedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("期間（recent3y / all）", () => {
  it("periodStartDate は3年前の同月同日", () => {
    expect(periodStartDate("2026-07-24")).toBe("2023-07-24");
    expect(periodStartDate("2024-02-29")).toBe("2021-02-29");
  });

  it("filterByPeriod は [3年前, 基準日] の閉区間（境界を含み、外側と未来を除く）", () => {
    const rows = [
      { listingDate: "2023-07-23" },
      { listingDate: "2023-07-24" },
      { listingDate: "2026-07-24" },
      { listingDate: "2026-07-25" },
    ];
    expect(filterByPeriod(rows, "recent3y", "2026-07-24").map((r) => r.listingDate)).toEqual([
      "2023-07-24",
      "2026-07-24",
    ]);
    expect(filterByPeriod(rows, "all", "2026-07-24")).toHaveLength(4);
    expect(filterByPeriod(rows, "recent3y")).toHaveLength(4);
  });

  it("基準日は上場済みなら上場日、上場前なら今日（未指定なら上場予定日）", () => {
    const up = ipoToOutcomeSource(baseIpo({ listingDate: "2026-10-10" }));
    expect(outcomeReferenceDate(up, "2026-09-25")).toBe("2026-09-25");
    expect(outcomeReferenceDate(up)).toBe("2026-10-10");
    expect(outcomeReferenceDate(listed("L", 0, { listingDate: "2025-03-01" }), "2026-09-25")).toBe("2025-03-01");
    expect(outcomeReferenceDate(historicalToOutcomeSource(hist("H", 0)), "2026-09-25")).toBe("2020-06-01");
  });

  it("outcomeDistribution の既定は recent3y、all は履歴も含む", () => {
    const target = baseIpo({ code: "T", listingDate: "2026-10-10" });
    const sources = combineOutcomeSources(
      [target, listed("A", 10, { listingDate: "2025-01-10" })],
      [hist("H1", -20, { listingDate: "2023-09-25" }), hist("H2", 50, { listingDate: "2023-09-24" })],
    );
    const t = ipoToOutcomeSource(target);
    const recent = outcomeDistributionByAbsorptionBand(sources, t, { todayIso: "2026-09-25" });
    expect(recent.samples.map((s) => s.code)).toEqual(["A", "H1"]);
    const all = outcomeDistributionByAbsorptionBand(sources, t, { period: "all", todayIso: "2026-09-25" });
    expect(all.sampleCount).toBe(3);
    expect(all.samples[2]).toMatchObject({ code: "H2", listingDate: "2023-09-24" });
  });

  it("上場済み target の recent3y は上場日より後の銘柄を含めない（結果リーク回避）", () => {
    const target = listed("T", 0, { listingDate: "2024-06-01" });
    const all = [target, listed("A", 10, { listingDate: "2024-05-31" }), listed("B", 10, { listingDate: "2024-06-02" })];
    expect(outcomeDistributionByAbsorptionBand(all, target).sampleCount).toBe(1);
    expect(outcomeDistributionByAbsorptionBand(all, target, { period: "all" }).sampleCount).toBe(2);
  });

  it("HistoricalIpo を直接混在させても集計でき、欠損（初値・市場・吸収金額・主幹事 null）は除外する", () => {
    const target = baseIpo({ code: "T", listingDate: "2023-01-01" });
    const mixed = [
      listed("A", 10, { listingDate: "2022-01-01" }),
      hist("H1", 30),
      hist("H2", null), // 初値なし
      hist("H3", 30, { market: null }), // 市場不明
      hist("H4", 30, { absorptionAmount: null }), // 吸収金額不明
      hist("H5", 30, { offeringPrice: null }), // 公開価格なし
    ];
    const result = outcomeDistributionByAbsorptionBand(mixed, target);
    expect(result.samples.map((s) => s.code)).toEqual(["A", "H1"]);
    expect(result.medianReturnRate).toBeCloseTo(20);
    expect(underwriterBreakEvenStat([hist("H6", -5, { leadUnderwriter: null })], "SBI証券")).toBeNull();
    expect(underwriterBreakEvenStat([hist("H7", -5)], "SBI証券")?.breakEvenRate).toBe(100);
  });

  it("market が null の target は母数0", () => {
    const t = historicalToOutcomeSource(hist("T", 10, { market: null }));
    expect(outcomeDistributionByAbsorptionBand([hist("A", 10)], t, { period: "all" }).sampleCount).toBe(0);
  });

  it("underwriterBreakEvenStat は referenceDate があるとき recent3y で絞り、all で全件", () => {
    const rows = [
      listed("A", -10, { listingDate: "2025-01-01", leadUnderwriter: "X証券" }),
      hist("H1", 20, { listingDate: "2021-01-01", leadUnderwriter: "X証券" }),
      hist("H2", -30, { listingDate: "2016-01-01", leadUnderwriter: "X証券" }),
    ];
    const recent = underwriterBreakEvenStat(rows, "X証券", { referenceDate: "2025-06-01" });
    expect(recent?.sampleCount).toBe(1);
    const all = underwriterBreakEvenStat(rows, "X証券", { period: "all", referenceDate: "2025-06-01" });
    expect(all?.sampleCount).toBe(3);
    expect(all?.breakEvenRate).toBeCloseTo((2 / 3) * 100);
    // 後方互換: 基準日なしは絞り込まない
    expect(underwriterBreakEvenStat(rows, "X証券")?.sampleCount).toBe(3);
  });

  it("combineOutcomeSources は コード×上場日 の重複だけ現行データを優先し、コード再利用は別銘柄として残す", () => {
    const current = [listed("1234", 10, { listingDate: "2023-12-20" })];
    const history = [
      hist("1234", 99, { listingDate: "2023-12-20" }),
      hist("1234", 5, { listingDate: "2016-03-01" }),
    ];
    const combined = combineOutcomeSources(current, history);
    expect(combined).toHaveLength(2);
    expect(combined[0].initialPrice).toBe(1100);
    expect(combined[1].listingDate).toBe("2016-03-01");
    expect(combined.every((s) => s.status === "listed")).toBe(true);
  });

  it("ipoToOutcomeSource は 0 以下の吸収金額・OR と空の主幹事を null に読み替える", () => {
    const s = ipoToOutcomeSource(baseIpo({ absorptionAmount: 0, offeringRatio: -1, leadUnderwriter: " " }));
    expect(s.absorptionAmount).toBeNull();
    expect(s.offeringRatio).toBeNull();
    expect(s.leadUnderwriter).toBeNull();
  });

  it("outcomeByPeriod は両期間を返し、主幹事統計から target 自身を除く", () => {
    const target = ipoToOutcomeSource(baseIpo({ code: "T", listingDate: "2026-10-10" }));
    const sources = [
      target,
      ipoToOutcomeSource(listed("T", -50, { listingDate: "2026-01-01" })),
      ipoToOutcomeSource(listed("A", -10, { listingDate: "2025-01-01" })),
      historicalToOutcomeSource(hist("H", 30, { listingDate: "2018-01-01" })),
    ];
    const r = outcomeByPeriod(sources, target, "2026-09-25");
    expect(r.recent3y.fromDate).toBe("2023-09-25");
    expect(r.recent3y.toDate).toBe("2026-09-25");
    expect(r.all.fromDate).toBeNull();
    expect(r.recent3y.distribution.sampleCount).toBe(1);
    expect(r.all.distribution.sampleCount).toBe(2);
    expect(r.recent3y.underwriter?.sampleCount).toBe(1);
    expect(r.all.underwriter?.sampleCount).toBe(2);
  });
});
