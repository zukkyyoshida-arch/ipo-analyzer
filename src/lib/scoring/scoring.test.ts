import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "./types";
import { DEFAULT_WEIGHTS, getPresetWeights } from "./weights";
import {
  scoreAbsorption,
  scoreMarket,
  scoreTheme,
  scoreVcLockup,
  scoreOfferingStructure,
  scoreUnderwriter,
  scoreSentiment,
  scoreSchedule,
  scoreDownside,
  scoreGrowth,
  scoreValuation,
  classifyLockStrength,
} from "./items";
import { scoreIpo, overallScore } from "./index";

// テスト用のベース銘柄。各テストで必要なフィールドだけ上書きする。
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

const neutralSettings: ScoreSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentiment: "neutral",
  underwriterCoefficients: {},
};

describe("scoreAbsorption 境界値", () => {
  it("10億未満は +2", () => {
    expect(scoreAbsorption(baseIpo({ absorptionAmount: 9.9 })).points).toBe(2);
  });
  it("ちょうど10億は +1", () => {
    expect(scoreAbsorption(baseIpo({ absorptionAmount: 10 })).points).toBe(1);
  });
  it("ちょうど30億は 0", () => {
    expect(scoreAbsorption(baseIpo({ absorptionAmount: 30 })).points).toBe(0);
  });
  it("ちょうど100億は -1", () => {
    expect(scoreAbsorption(baseIpo({ absorptionAmount: 100 })).points).toBe(-1);
  });
  it("ちょうど500億は -2", () => {
    expect(scoreAbsorption(baseIpo({ absorptionAmount: 500 })).points).toBe(-2);
  });
});

describe("scoreMarket", () => {
  it("グロースは +1", () => {
    expect(scoreMarket(baseIpo({ market: "グロース" })).points).toBe(1);
  });
  it("スタンダードは 0", () => {
    expect(scoreMarket(baseIpo({ market: "スタンダード" })).points).toBe(0);
  });
  it("プライムは -1", () => {
    expect(scoreMarket(baseIpo({ market: "プライム" })).points).toBe(-1);
  });
});

describe("scoreTheme", () => {
  it("人気テーマ（AI）を含むと +2", () => {
    expect(scoreTheme(baseIpo({ theme: ["AI", "その他"] })).points).toBe(2);
  });
  it("中立テーマは 0", () => {
    expect(scoreTheme(baseIpo({ theme: ["その他"] })).points).toBe(0);
  });
  it("不人気タグを含むと -2（人気テーマより優先）", () => {
    expect(
      scoreTheme(baseIpo({ theme: ["不人気", "AI"] })).points,
    ).toBe(-2);
  });
});

describe("classifyLockStrength と scoreVcLockup マトリクス", () => {
  it("180日・解除なしは strong", () => {
    expect(
      classifyLockStrength(
        baseIpo({ lockup: { days: 180, hasPriceRelease: false, coverage: 60 } }),
      ),
    ).toBe("strong");
  });
  it("1.5倍解除ありは medium", () => {
    expect(
      classifyLockStrength(
        baseIpo({ lockup: { days: 180, hasPriceRelease: true, coverage: 60 } }),
      ),
    ).toBe("medium");
  });
  it("90日未満は weak", () => {
    expect(
      classifyLockStrength(
        baseIpo({ lockup: { days: 60, hasPriceRelease: false, coverage: 60 } }),
      ),
    ).toBe("weak");
  });
  it("VC<10%・強ロックは +2", () => {
    const ipo = baseIpo({
      vcRatio: 5,
      lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
    });
    expect(scoreVcLockup(ipo).points).toBe(2);
  });
  it("VC>30%・弱ロックは -2", () => {
    const ipo = baseIpo({
      vcRatio: 40,
      lockup: { days: 60, hasPriceRelease: false, coverage: 60 },
    });
    expect(scoreVcLockup(ipo).points).toBe(-2);
  });
  it("VC10-30%・中ロックは 0", () => {
    const ipo = baseIpo({
      vcRatio: 20,
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
    });
    expect(scoreVcLockup(ipo).points).toBe(0);
  });
});

describe("scoreOfferingStructure", () => {
  it("公募中心は +1", () => {
    const ipo = baseIpo({
      publicShares: 800000,
      saleShares: 200000,
      offeringRatio: 20,
    });
    expect(scoreOfferingStructure(ipo).points).toBe(1);
  });
  it("同程度（差20%以内）は 0", () => {
    const ipo = baseIpo({
      publicShares: 500000,
      saleShares: 450000,
      offeringRatio: 20,
    });
    expect(scoreOfferingStructure(ipo).points).toBe(0);
  });
  it("売出中心は -1", () => {
    const ipo = baseIpo({
      publicShares: 200000,
      saleShares: 800000,
      offeringRatio: 20,
    });
    expect(scoreOfferingStructure(ipo).points).toBe(-1);
  });
  it("売出中心かつ放出比率>30%は -2（下限）", () => {
    const ipo = baseIpo({
      publicShares: 200000,
      saleShares: 800000,
      offeringRatio: 35,
    });
    expect(scoreOfferingStructure(ipo).points).toBe(-2);
  });
  it("公募中心でも放出比率>30%なら -1 で相殺される", () => {
    const ipo = baseIpo({
      publicShares: 800000,
      saleShares: 200000,
      offeringRatio: 35,
    });
    expect(scoreOfferingStructure(ipo).points).toBe(0);
  });
});

describe("scoreUnderwriter", () => {
  it("設定係数を反映する", () => {
    const settings: ScoreSettings = {
      ...neutralSettings,
      underwriterCoefficients: { SBI証券: 1 },
    };
    expect(scoreUnderwriter(baseIpo(), settings).points).toBe(1);
  });
  it("未設定の主幹事は 0", () => {
    expect(scoreUnderwriter(baseIpo(), neutralSettings).points).toBe(0);
  });
  it("範囲外の係数は -2〜+2 にクランプ", () => {
    const settings: ScoreSettings = {
      ...neutralSettings,
      underwriterCoefficients: { SBI証券: 9 },
    };
    expect(scoreUnderwriter(baseIpo(), settings).points).toBe(2);
  });
});

describe("scoreSentiment", () => {
  it("強いは +2", () => {
    expect(
      scoreSentiment({ ...neutralSettings, sentiment: "strong" }).points,
    ).toBe(2);
  });
  it("普通は 0", () => {
    expect(scoreSentiment(neutralSettings).points).toBe(0);
  });
  it("弱いは -2", () => {
    expect(
      scoreSentiment({ ...neutralSettings, sentiment: "weak" }).points,
    ).toBe(-2);
  });
});

describe("scoreSchedule", () => {
  it("過密なしは 0", () => {
    expect(
      scoreSchedule(baseIpo({ sameDayListings: 1, sameWeekListings: 2 }))
        .points,
    ).toBe(0);
  });
  it("同日上場ありは -1", () => {
    expect(
      scoreSchedule(baseIpo({ sameDayListings: 2, sameWeekListings: 2 }))
        .points,
    ).toBe(-1);
  });
  it("同日あり＋同週3件以上は -2", () => {
    expect(
      scoreSchedule(baseIpo({ sameDayListings: 2, sameWeekListings: 3 }))
        .points,
    ).toBe(-2);
  });
});

describe("scoreDownside", () => {
  it("複合条件（吸収>100億・売出中心・人気テーマなし）で -2", () => {
    const ipo = baseIpo({
      absorptionAmount: 150,
      publicShares: 200000,
      saleShares: 800000,
      theme: ["その他"],
    });
    expect(scoreDownside(ipo).points).toBe(-2);
  });
  it("人気テーマありなら該当しない", () => {
    const ipo = baseIpo({
      absorptionAmount: 150,
      publicShares: 200000,
      saleShares: 800000,
      theme: ["AI"],
    });
    expect(scoreDownside(ipo).points).toBe(0);
  });
  it("吸収金額が小さければ該当しない", () => {
    const ipo = baseIpo({
      absorptionAmount: 20,
      publicShares: 200000,
      saleShares: 800000,
      theme: ["その他"],
    });
    expect(scoreDownside(ipo).points).toBe(0);
  });
});

describe("scoreGrowth", () => {
  it("成長率>30%かつ黒字は +2", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 1,
        revenueGrowth: 40,
        operatingProfit: 1,
        isProfitable: true,
      },
    });
    expect(scoreGrowth(ipo).points).toBe(2);
  });
  it("成長率>15%かつ黒字は +1", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 1,
        revenueGrowth: 20,
        operatingProfit: 1,
        isProfitable: true,
      },
    });
    expect(scoreGrowth(ipo).points).toBe(1);
  });
  it("黒字低成長は 0", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 1,
        revenueGrowth: 10,
        operatingProfit: 1,
        isProfitable: true,
      },
    });
    expect(scoreGrowth(ipo).points).toBe(0);
  });
  it("赤字高成長は -1", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 1,
        revenueGrowth: 40,
        operatingProfit: -1,
        isProfitable: false,
      },
    });
    expect(scoreGrowth(ipo).points).toBe(-1);
  });
  it("赤字低成長は -2", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 1,
        revenueGrowth: 10,
        operatingProfit: -1,
        isProfitable: false,
      },
    });
    expect(scoreGrowth(ipo).points).toBe(-2);
  });
});

describe("scoreValuation", () => {
  it("PSR<5は +1", () => {
    expect(scoreValuation(baseIpo({ psr: 4 })).points).toBe(1);
  });
  it("PSR 5-15は 0", () => {
    expect(scoreValuation(baseIpo({ psr: 10 })).points).toBe(0);
  });
  it("PSR>15は -1", () => {
    expect(scoreValuation(baseIpo({ psr: 20 })).points).toBe(-1);
  });
  it("PSRがnullなら 0（中立）", () => {
    expect(scoreValuation(baseIpo({ psr: null })).points).toBe(0);
  });
});

describe("scoreIpo 総合計算", () => {
  it("需給・ファンダとも 0〜100 の範囲に収まる", () => {
    const result = scoreIpo(baseIpo(), neutralSettings);
    expect(result.supplyDemand.score).toBeGreaterThanOrEqual(0);
    expect(result.supplyDemand.score).toBeLessThanOrEqual(100);
    expect(result.fundamental.score).toBeGreaterThanOrEqual(0);
    expect(result.fundamental.score).toBeLessThanOrEqual(100);
  });

  it("需給の強い銘柄は高い需給スコアになる（downside/scheduleは減点専用のため100は出ない）", () => {
    const strongIpo = baseIpo({
      absorptionAmount: 5,
      market: "グロース",
      theme: ["AI", "SaaS"],
      vcRatio: 5,
      lockup: { days: 180, hasPriceRelease: false, coverage: 80 },
      publicShares: 900000,
      saleShares: 100000,
      offeringRatio: 15,
      sameDayListings: 1,
      sameWeekListings: 1,
    });
    const settings: ScoreSettings = {
      ...neutralSettings,
      sentiment: "strong",
      underwriterCoefficients: { SBI証券: 2 },
    };
    const result = scoreIpo(strongIpo, settings);
    expect(result.supplyDemand.score).toBeGreaterThan(80);
  });

  it("需給が弱い銘柄は低スコアになる", () => {
    const weakIpo = baseIpo({
      absorptionAmount: 600,
      market: "プライム",
      theme: ["不人気"],
      vcRatio: 40,
      lockup: { days: 60, hasPriceRelease: false, coverage: 30 },
      publicShares: 100000,
      saleShares: 900000,
      offeringRatio: 45,
      sameDayListings: 2,
      sameWeekListings: 4,
    });
    const settings: ScoreSettings = {
      ...neutralSettings,
      sentiment: "weak",
    };
    const result = scoreIpo(weakIpo, settings);
    expect(result.supplyDemand.score).toBeLessThan(20);
  });

  it("全重み0なら中立の50点を返す（ゼロ除算回避）", () => {
    const zeroWeights = Object.fromEntries(
      Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]),
    ) as typeof DEFAULT_WEIGHTS;
    const settings: ScoreSettings = {
      ...neutralSettings,
      weights: zeroWeights,
    };
    const result = scoreIpo(baseIpo(), settings);
    expect(result.supplyDemand.score).toBe(50);
    expect(result.fundamental.score).toBe(50);
  });

  it("重みプリセットを変えるとファンダ軸スコアが変化する", () => {
    // growth=-2（赤字低成長）、valuation=-1（PSR>15）と点数が異なる銘柄。
    // ファンダ重みの比率（growth:valuation）がプリセットで変わるため軸スコアが変化する。
    const ipo = baseIpo({
      theme: ["AI"],
      financials: {
        revenue: 1,
        revenueGrowth: 5,
        operatingProfit: -1,
        isProfitable: false,
      },
      psr: 20,
    });
    const supplyFocused: ScoreSettings = {
      ...neutralSettings,
      weights: getPresetWeights("supplyDemand"), // growth:1, valuation:1
    };
    const fundaFocused: ScoreSettings = {
      ...neutralSettings,
      weights: getPresetWeights("fundamental"), // growth:5, valuation:4
    };
    const sd = scoreIpo(ipo, supplyFocused);
    const fd = scoreIpo(ipo, fundaFocused);
    expect(sd.fundamental.score).not.toBe(fd.fundamental.score);
  });

  it("overallScore は2軸の平均", () => {
    const result = scoreIpo(baseIpo(), neutralSettings);
    const expected = Math.round(
      (result.supplyDemand.score + result.fundamental.score) / 2,
    );
    expect(overallScore(result)).toBe(expected);
  });

  it("寄与ポイントは points × weight に一致する", () => {
    const result = scoreIpo(baseIpo(), neutralSettings);
    for (const item of result.supplyDemand.items) {
      expect(item.contribution).toBe(item.points * item.weight);
    }
  });
});
