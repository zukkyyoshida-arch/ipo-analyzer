import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";
import type { ScoreSettings } from "./types";
import { DEFAULT_WEIGHTS } from "./weights";
import { checkPriceRangeRevision } from "@/lib/checklist/items";
import {
  BB_SCORE_KEYS,
  BB_SCORE_ITEM_LABELS,
  DEFAULT_BB_WEIGHTS,
  UNDERWRITER_MIN_SAMPLE,
  scoreBbParticipation,
  scoreOfferingRatioBb,
  scorePriceRangePosition,
  scoreUnderwriterTrack,
  type BbScoreWeights,
} from "./bb";

// テスト用のベース銘柄。scoring.test.ts のスタイルに合わせる。
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
    saleShares: 300000,
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

function stat(overrides: Partial<UnderwriterBreakEvenStat> = {}): UnderwriterBreakEvenStat {
  return {
    underwriter: "SBI証券",
    sampleCount: 10,
    breakEvenRate: 15,
    meanReturn: 30,
    lowSample: false,
    ...overrides,
  };
}

const neutralSettings: ScoreSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentiment: "neutral",
  underwriterCoefficients: {},
};

describe("BB参加スコアの定数", () => {
  it("6項目すべてにラベルと既定重みがある", () => {
    expect(BB_SCORE_KEYS).toHaveLength(6);
    for (const key of BB_SCORE_KEYS) {
      expect(BB_SCORE_ITEM_LABELS[key]).toBeTruthy();
      expect(DEFAULT_BB_WEIGHTS[key]).toBeGreaterThan(0);
    }
  });
  it("既定重みはバックテストで確定した値（主幹事実績のみ 3→2）", () => {
    expect(DEFAULT_BB_WEIGHTS).toEqual({
      absorption: 4,
      offeringRatioBb: 4,
      underwriterTrack: 2,
      priceRangePosition: 3,
      vcLockup: 2,
      sentiment: 2,
    });
  });
});

describe("scoreOfferingRatioBb 境界値", () => {
  const cases: [number, number][] = [
    [9.9, 2],
    [10, 1],
    [19.9, 1],
    [20, 0],
    [29.9, 0],
    [30, -1],
    [49.9, -1],
    [50, -2],
    [80, -2],
  ];
  it.each(cases)("OR %s%% は %s 点", (ratio, expected) => {
    expect(scoreOfferingRatioBb(baseIpo({ offeringRatio: ratio })).points).toBe(expected);
  });
  it("OR 0（未取得）は 0 点・rawText「未取得」", () => {
    const r = scoreOfferingRatioBb(baseIpo({ offeringRatio: 0 }));
    expect(r.points).toBe(0);
    expect(r.rawText).toBe("未取得");
  });
});

describe("scoreUnderwriterTrack", () => {
  it("実績なし（null）は 0 点", () => {
    const r = scoreUnderwriterTrack(null);
    expect(r.points).toBe(0);
    expect(r.rawText).toBe("実績なし");
  });
  it("母数5件未満は公募割れ率が低くても unknown 扱いで 0 点", () => {
    const r = scoreUnderwriterTrack(stat({ sampleCount: UNDERWRITER_MIN_SAMPLE - 1, breakEvenRate: 0, lowSample: true }));
    expect(r.points).toBe(0);
    expect(r.rawText).toContain("母数4件");
  });
  it("母数5件ちょうどから段階判定される", () => {
    expect(scoreUnderwriterTrack(stat({ sampleCount: 5, breakEvenRate: 0 })).points).toBe(2);
  });
  const cases: [number, number][] = [
    [4.9, 2],
    [5, 1],
    [9.9, 1],
    [10, 0],
    [19.9, 0],
    [20, -1],
    [29.9, -1],
    [30, -2],
  ];
  it.each(cases)("公募割れ率 %s%% は %s 点", (rate, expected) => {
    expect(scoreUnderwriterTrack(stat({ breakEvenRate: rate })).points).toBe(expected);
  });
});

describe("scorePriceRangePosition（checklist と同じ境界）", () => {
  it("仮条件下限が想定価格より上は +2（checklist: pass）", () => {
    const ipo = baseIpo({ assumedPrice: 1000, priceRange: { low: 1010, high: 1100 } });
    expect(scorePriceRangePosition(ipo).points).toBe(2);
    expect(checkPriceRangeRevision(ipo).verdict).toBe("pass");
  });
  it("仮条件下限が想定価格ちょうどは 0（checklist: warn）", () => {
    const ipo = baseIpo({ assumedPrice: 1000, priceRange: { low: 1000, high: 1100 } });
    expect(scorePriceRangePosition(ipo).points).toBe(0);
    expect(checkPriceRangeRevision(ipo).verdict).toBe("warn");
  });
  it("仮条件上限が想定価格ちょうどは 0（checklist: warn）", () => {
    const ipo = baseIpo({ assumedPrice: 1000, priceRange: { low: 900, high: 1000 } });
    expect(scorePriceRangePosition(ipo).points).toBe(0);
    expect(checkPriceRangeRevision(ipo).verdict).toBe("warn");
  });
  it("仮条件上限が想定価格より下は -2（checklist: fail）", () => {
    const ipo = baseIpo({ assumedPrice: 1000, priceRange: { low: 800, high: 990 } });
    expect(scorePriceRangePosition(ipo).points).toBe(-2);
    expect(checkPriceRangeRevision(ipo).verdict).toBe("fail");
  });
  it("想定価格0・仮条件0は未取得で 0 点（checklist: unknown）", () => {
    const noAssumed = baseIpo({ assumedPrice: 0 });
    const noRange = baseIpo({ priceRange: { low: 0, high: 0 } });
    expect(scorePriceRangePosition(noAssumed)).toMatchObject({ points: 0, rawText: "未取得" });
    expect(scorePriceRangePosition(noRange)).toMatchObject({ points: 0, rawText: "未取得" });
    expect(checkPriceRangeRevision(noAssumed).verdict).toBe("unknown");
  });
  it("仮条件未発表（想定価格を low=high で埋めた状態）は未取得で 0 点", () => {
    const r = scorePriceRangePosition(baseIpo({ assumedPrice: 1200, priceRange: { low: 1200, high: 1200 } }));
    expect(r).toMatchObject({ points: 0, rawText: "未取得" });
  });
});

describe("scoreBbParticipation", () => {
  it("全項目0点なら50点（中立）", () => {
    // 吸収金額50億=0 / OR25%=0 / 公募割れ率15%=0 / レンジ内=0 / VC20%×ロック中=0 / 地合い普通=0
    const r = scoreBbParticipation(baseIpo(), neutralSettings, stat());
    expect(r.items.every((i) => i.points === 0)).toBe(true);
    expect(r.score).toBe(50);
  });
  it("全重み0でもゼロ除算せず50点", () => {
    const zero = Object.fromEntries(BB_SCORE_KEYS.map((k) => [k, 0])) as BbScoreWeights;
    const ipo = baseIpo({ absorptionAmount: 5, offeringRatio: 5 });
    const r = scoreBbParticipation(ipo, neutralSettings, stat(), zero);
    expect(r.score).toBe(50);
    expect(Number.isNaN(r.score)).toBe(false);
  });
  it("全項目+2なら100点、全項目-2なら0点", () => {
    const best = baseIpo({
      absorptionAmount: 5,
      offeringRatio: 5,
      assumedPrice: 1000,
      priceRange: { low: 1100, high: 1200 },
      vcRatio: 5,
      lockup: { days: 180, hasPriceRelease: false, coverage: 90 },
    });
    const worst = baseIpo({
      absorptionAmount: 600,
      offeringRatio: 60,
      assumedPrice: 1000,
      priceRange: { low: 800, high: 900 },
      vcRatio: 40,
      lockup: { days: 60, hasPriceRelease: true, coverage: 10 },
    });
    expect(
      scoreBbParticipation(best, { ...neutralSettings, sentiment: "strong" }, stat({ breakEvenRate: 0 })).score,
    ).toBe(100);
    expect(
      scoreBbParticipation(worst, { ...neutralSettings, sentiment: "weak" }, stat({ breakEvenRate: 50 })).score,
    ).toBe(0);
  });
  it("吸収金額・OR・ロックアップ・仮条件が未取得の銘柄は各項目 0 点・未取得表示", () => {
    const skeleton = baseIpo({
      absorptionAmount: 0,
      offeringRatio: 0,
      assumedPrice: 0,
      priceRange: { low: 0, high: 0 },
      vcRatio: 0,
      lockup: { days: 0, hasPriceRelease: false, coverage: 0 },
    });
    const r = scoreBbParticipation(skeleton, neutralSettings, null);
    expect(r.score).toBe(50);
    for (const key of ["absorption", "offeringRatioBb", "priceRangePosition", "vcLockup"] as const) {
      const item = r.items.find((i) => i.key === key);
      expect(item?.points).toBe(0);
      expect(item?.rawText).toBe("未取得");
    }
  });
  it("寄与は points × weight、項目順は BB_SCORE_KEYS 通り", () => {
    const ipo = baseIpo({ absorptionAmount: 5, offeringRatio: 60 });
    const r = scoreBbParticipation(ipo, { ...neutralSettings, sentiment: "strong" }, stat());
    expect(r.items.map((i) => i.key)).toEqual(BB_SCORE_KEYS);
    const absorption = r.items.find((i) => i.key === "absorption");
    expect(absorption).toMatchObject({ points: 2, weight: 4, contribution: 8, label: "吸収金額" });
    const or = r.items.find((i) => i.key === "offeringRatioBb");
    expect(or).toMatchObject({ points: -2, weight: 4, contribution: -8 });
    const sentiment = r.items.find((i) => i.key === "sentiment");
    expect(sentiment).toMatchObject({ points: 2, weight: 2, contribution: 4 });
    // raw=+4、総重み17 → (4+34)/68*100 = 55.88 → 56
    expect(r.score).toBe(56);
  });
  it("重みを渡すとその重みで計算される", () => {
    const ipo = baseIpo({ absorptionAmount: 5 });
    const onlyAbsorption = Object.fromEntries(
      BB_SCORE_KEYS.map((k) => [k, k === "absorption" ? 1 : 0]),
    ) as BbScoreWeights;
    expect(scoreBbParticipation(ipo, neutralSettings, stat(), onlyAbsorption).score).toBe(100);
  });
});
