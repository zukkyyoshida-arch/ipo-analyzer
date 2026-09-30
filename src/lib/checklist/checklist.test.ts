import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import { determinePhase } from "./phase";
import {
  checkPriceRangeRevision,
  checkAbsorption,
  checkGrowth,
  checkLockup,
  checkUnderwriter,
  checkOfferingStructure,
  checkSchedule,
  checkDealType,
  checkInitialPriceRatio,
  checkInitialVolume,
  checkMarginRestriction,
  checkFirstEarnings,
  checkLockupExpiry,
  checkPriceReleaseLine,
  checkTopixInclusion,
  checkVolumeLevel,
  checkLargeHolding,
} from "./items";
import { buildChecklist } from "./index";

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

describe("determinePhase", () => {
  it("上場日前は bb", () => {
    expect(determinePhase(baseIpo({ listingDate: "2026-07-24" }), "2026-07-23")).toBe(
      "bb",
    );
  });
  it("上場当日は listingDay", () => {
    expect(determinePhase(baseIpo({ listingDate: "2026-07-24" }), "2026-07-24")).toBe(
      "listingDay",
    );
  });
  it("上場翌日は secondary", () => {
    expect(determinePhase(baseIpo({ listingDate: "2026-07-24" }), "2026-07-25")).toBe(
      "secondary",
    );
  });
  it("listingDate が空なら bb", () => {
    expect(determinePhase(baseIpo({ listingDate: "" }), "2026-07-25")).toBe("bb");
  });
});

describe("checkPriceRangeRevision", () => {
  it("仮条件が想定価格より上振れなら pass", () => {
    const ipo = baseIpo({ assumedPrice: 900, priceRange: { low: 950, high: 1050 } });
    expect(checkPriceRangeRevision(ipo).verdict).toBe("pass");
  });
  it("仮条件が想定価格より下振れなら fail", () => {
    const ipo = baseIpo({ assumedPrice: 1100, priceRange: { low: 950, high: 1050 } });
    expect(checkPriceRangeRevision(ipo).verdict).toBe("fail");
  });
  it("想定価格がレンジ内なら warn", () => {
    const ipo = baseIpo({ assumedPrice: 1000, priceRange: { low: 950, high: 1050 } });
    expect(checkPriceRangeRevision(ipo).verdict).toBe("warn");
  });
  it("データ未確定なら unknown", () => {
    const ipo = baseIpo({ assumedPrice: 0, priceRange: { low: 0, high: 0 } });
    expect(checkPriceRangeRevision(ipo).verdict).toBe("unknown");
  });
});

describe("checkAbsorption 境界値", () => {
  it("10億未満は pass", () => {
    expect(checkAbsorption(baseIpo({ absorptionAmount: 9.9 })).verdict).toBe("pass");
  });
  it("ちょうど10億は warn", () => {
    expect(checkAbsorption(baseIpo({ absorptionAmount: 10 })).verdict).toBe("warn");
  });
  it("ちょうど30億は fail", () => {
    expect(checkAbsorption(baseIpo({ absorptionAmount: 30 })).verdict).toBe("fail");
  });
});

describe("checkGrowth", () => {
  it("黒字かつ成長率20%以上は pass", () => {
    const ipo = baseIpo({
      financials: { revenue: 1, revenueGrowth: 20, operatingProfit: 1, isProfitable: true },
    });
    expect(checkGrowth(ipo).verdict).toBe("pass");
  });
  it("黒字かつ成長率20%未満は warn", () => {
    const ipo = baseIpo({
      financials: { revenue: 1, revenueGrowth: 19, operatingProfit: 1, isProfitable: true },
    });
    expect(checkGrowth(ipo).verdict).toBe("warn");
  });
  it("赤字かつ成長率30%以上は warn", () => {
    const ipo = baseIpo({
      financials: { revenue: 1, revenueGrowth: 30, operatingProfit: -1, isProfitable: false },
    });
    expect(checkGrowth(ipo).verdict).toBe("warn");
  });
  it("赤字かつ成長率30%未満は fail", () => {
    const ipo = baseIpo({
      financials: { revenue: 1, revenueGrowth: 29, operatingProfit: -1, isProfitable: false },
    });
    expect(checkGrowth(ipo).verdict).toBe("fail");
  });
});

describe("checkLockup", () => {
  it("VC比率10%未満は pass", () => {
    const ipo = baseIpo({ vcRatio: 5, lockup: { days: 60, hasPriceRelease: true, coverage: 30 } });
    expect(checkLockup(ipo).verdict).toBe("pass");
  });
  it("180日ロック・解除なしは pass", () => {
    const ipo = baseIpo({ vcRatio: 20, lockup: { days: 180, hasPriceRelease: false, coverage: 60 } });
    expect(checkLockup(ipo).verdict).toBe("pass");
  });
  it("1.5倍解除条項ありは warn", () => {
    const ipo = baseIpo({ vcRatio: 20, lockup: { days: 180, hasPriceRelease: true, coverage: 60 } });
    expect(checkLockup(ipo).verdict).toBe("warn");
  });
  it("90日未満は fail", () => {
    const ipo = baseIpo({ vcRatio: 20, lockup: { days: 60, hasPriceRelease: false, coverage: 60 } });
    expect(checkLockup(ipo).verdict).toBe("fail");
  });
});

describe("checkUnderwriter", () => {
  it("大手主幹事は pass", () => {
    expect(checkUnderwriter(baseIpo({ leadUnderwriter: "野村證券" })).verdict).toBe("pass");
  });
  it("SBI証券は部分一致で pass", () => {
    expect(checkUnderwriter(baseIpo({ leadUnderwriter: "SBI証券" })).verdict).toBe("pass");
  });
  it("大手以外は warn", () => {
    expect(checkUnderwriter(baseIpo({ leadUnderwriter: "岩井コスモ証券" })).verdict).toBe("warn");
  });
});

describe("checkOfferingStructure", () => {
  it("放出比率30%超は fail", () => {
    expect(checkOfferingStructure(baseIpo({ offeringRatio: 31 })).verdict).toBe("fail");
  });
  it("売出中心は warn", () => {
    const ipo = baseIpo({ publicShares: 200000, saleShares: 800000, offeringRatio: 20 });
    expect(checkOfferingStructure(ipo).verdict).toBe("warn");
  });
  it("公募中心は pass", () => {
    const ipo = baseIpo({ publicShares: 800000, saleShares: 200000, offeringRatio: 20 });
    expect(checkOfferingStructure(ipo).verdict).toBe("pass");
  });
});

describe("checkSchedule", () => {
  it("同日・同週とも過密は fail", () => {
    expect(
      checkSchedule(baseIpo({ sameDayListings: 2, sameWeekListings: 3 })).verdict,
    ).toBe("fail");
  });
  it("どちらか一方は warn", () => {
    expect(
      checkSchedule(baseIpo({ sameDayListings: 2, sameWeekListings: 1 })).verdict,
    ).toBe("warn");
  });
  it("過密なしは pass", () => {
    expect(
      checkSchedule(baseIpo({ sameDayListings: 1, sameWeekListings: 1 })).verdict,
    ).toBe("pass");
  });
});

describe("checkDealType", () => {
  it("VC比率30%超×売出中心は warn", () => {
    const ipo = baseIpo({ vcRatio: 31, publicShares: 200000, saleShares: 800000 });
    expect(checkDealType(ipo).verdict).toBe("warn");
  });
  it("それ以外は pass", () => {
    const ipo = baseIpo({ vcRatio: 20, publicShares: 800000, saleShares: 200000 });
    expect(checkDealType(ipo).verdict).toBe("pass");
  });
});

describe("checkInitialPriceRatio 境界値", () => {
  it("1.5倍ちょうどは pass", () => {
    const ipo = baseIpo({ offeringPrice: 1000, initialPrice: 1500 });
    expect(checkInitialPriceRatio(ipo).verdict).toBe("pass");
  });
  it("1.5倍超2.0倍以下は warn", () => {
    const ipo = baseIpo({ offeringPrice: 1000, initialPrice: 2000 });
    expect(checkInitialPriceRatio(ipo).verdict).toBe("warn");
  });
  it("2.0倍超は fail", () => {
    const ipo = baseIpo({ offeringPrice: 1000, initialPrice: 2001 });
    expect(checkInitialPriceRatio(ipo).verdict).toBe("fail");
  });
  it("初値未形成は unknown", () => {
    const ipo = baseIpo({ offeringPrice: 1000, initialPrice: null });
    expect(checkInitialPriceRatio(ipo).verdict).toBe("unknown");
  });
  it("1.5倍超・2.0倍超は過去データの注記（20営業日後の平均）を添える", () => {
    const warn = checkInitialPriceRatio(baseIpo({ offeringPrice: 1000, initialPrice: 1800 }));
    expect(warn.detail).toContain("過去データでは5営業日以降が不利");
    expect(warn.detail).toContain("20営業日後 平均 −17.8%");
    const fail = checkInitialPriceRatio(baseIpo({ offeringPrice: 1000, initialPrice: 2500 }));
    expect(fail.detail).toContain("20営業日後 平均 −21.1%");
    const pass = checkInitialPriceRatio(baseIpo({ offeringPrice: 1000, initialPrice: 1200 }));
    expect(pass.detail).not.toContain("過去データ");
  });
});

describe("checkInitialVolume 境界値", () => {
  it("消化率50%ちょうどは pass", () => {
    const ipo = baseIpo({
      publicShares: 500000,
      saleShares: 300000,
      overAllotment: 200000,
      initialVolume: 500000, // 500000 / 1000000 = 0.5
    });
    expect(checkInitialVolume(ipo).verdict).toBe("pass");
  });
  it("消化率50%未満は fail", () => {
    const ipo = baseIpo({
      publicShares: 500000,
      saleShares: 300000,
      overAllotment: 200000,
      initialVolume: 499999,
    });
    expect(checkInitialVolume(ipo).verdict).toBe("fail");
  });
  it("データなしは manual", () => {
    const ipo = baseIpo({ initialVolume: null });
    expect(checkInitialVolume(ipo).verdict).toBe("manual");
  });
});

describe("checkMarginRestriction", () => {
  it("true は warn", () => {
    expect(checkMarginRestriction(baseIpo({ marginRestriction: true })).verdict).toBe(
      "warn",
    );
  });
  it("false は pass", () => {
    expect(checkMarginRestriction(baseIpo({ marginRestriction: false })).verdict).toBe(
      "pass",
    );
  });
  it("undefined は manual", () => {
    expect(checkMarginRestriction(baseIpo({})).verdict).toBe("manual");
  });
});

describe("checkFirstEarnings 境界値", () => {
  it("残り14日ちょうどは fail", () => {
    const ipo = baseIpo({ firstEarningsDate: "2026-08-08" });
    expect(checkFirstEarnings(ipo, "2026-07-25").verdict).toBe("fail");
  });
  it("残り15日は warn", () => {
    const ipo = baseIpo({ firstEarningsDate: "2026-08-09" });
    expect(checkFirstEarnings(ipo, "2026-07-25").verdict).toBe("warn");
  });
  it("通過済みは pass", () => {
    const ipo = baseIpo({ firstEarningsDate: "2026-07-20" });
    expect(checkFirstEarnings(ipo, "2026-07-25").verdict).toBe("pass");
  });
  it("未定なら manual", () => {
    const ipo = baseIpo({ firstEarningsDate: null });
    expect(checkFirstEarnings(ipo, "2026-07-25").verdict).toBe("manual");
  });
});

describe("checkLockupExpiry", () => {
  it("解除日が14日以内に接近していれば warn", () => {
    const ipo = baseIpo({ listingDate: "2026-07-01", lockup: { days: 30, hasPriceRelease: false, coverage: 50 } });
    // 解除日 2026-07-31、today 2026-07-20 → 残り11日
    expect(checkLockupExpiry(ipo, "2026-07-20").verdict).toBe("warn");
  });
  it("解除通過済みは pass", () => {
    const ipo = baseIpo({ listingDate: "2026-07-01", lockup: { days: 30, hasPriceRelease: false, coverage: 50 } });
    expect(checkLockupExpiry(ipo, "2026-08-15").verdict).toBe("pass");
  });
});

describe("checkPriceReleaseLine", () => {
  it("解除条項なしは pass", () => {
    const ipo = baseIpo({ lockup: { days: 180, hasPriceRelease: false, coverage: 60 } });
    expect(checkPriceReleaseLine(ipo).verdict).toBe("pass");
  });
  it("1.5倍到達は fail", () => {
    const ipo = baseIpo({
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 1000,
      currentPrice: 1500,
    });
    expect(checkPriceReleaseLine(ipo).verdict).toBe("fail");
  });
  it("1.4倍以上1.5倍未満は warn", () => {
    const ipo = baseIpo({
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 1000,
      currentPrice: 1450,
    });
    expect(checkPriceReleaseLine(ipo).verdict).toBe("warn");
  });
  it("データ不足は unknown", () => {
    const ipo = baseIpo({
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
      offeringPrice: null,
      currentPrice: null,
    });
    expect(checkPriceReleaseLine(ipo).verdict).toBe("unknown");
  });
  it("株式分割後は現在値を上場時の単位に直して比べる（350A 相当: 1:6 分割・現在値684円）", () => {
    const ipo = baseIpo({
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 4520,
      currentPrice: 684,
      splitFactor: 6,
    });
    const item = checkPriceReleaseLine(ipo);
    // 684×6=4,104円は公開価格の0.91倍。分割前の単位で比べれば 1.5倍ライン到達ではない。
    expect(item.verdict).toBe("pass");
    // 表示する 1.5倍ラインは現在の単位（6,780円÷6=1,130円）。
    expect(item.detail).toContain("1,130円・分割換算後");
  });
  it("株式分割後に1.5倍を超えれば fail（現在値の単位のままなら見逃す）", () => {
    const ipo = baseIpo({
      lockup: { days: 180, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 1000,
      currentPrice: 800,
      splitFactor: 2,
    });
    expect(checkPriceReleaseLine(ipo).verdict).toBe("fail");
  });
});

describe("checkTopixInclusion", () => {
  it("プライム以外では項目自体が含まれない（null）", () => {
    expect(checkTopixInclusion(baseIpo({ market: "グロース" }), "2026-07-25")).toBeNull();
  });
  it("プライムでは項目が含まれる", () => {
    expect(checkTopixInclusion(baseIpo({ market: "プライム" }), "2026-07-25")).not.toBeNull();
  });
});

describe("checkVolumeLevel 境界値", () => {
  it("10万株ちょうどは pass", () => {
    expect(checkVolumeLevel(baseIpo({ recentVolume: 100000 })).verdict).toBe("pass");
  });
  it("10万株未満は fail", () => {
    expect(checkVolumeLevel(baseIpo({ recentVolume: 99999 })).verdict).toBe("fail");
  });
  it("データなしは manual", () => {
    expect(checkVolumeLevel(baseIpo({ recentVolume: null })).verdict).toBe("manual");
  });
});

describe("checkLargeHolding", () => {
  it("報告ありは pass", () => {
    const ipo = baseIpo({ largeHoldingReport: { date: "2026-07-20", holder: "テストファンド" } });
    expect(checkLargeHolding(ipo).verdict).toBe("pass");
  });
  it("報告なしは manual", () => {
    expect(checkLargeHolding(baseIpo({ largeHoldingReport: null })).verdict).toBe("manual");
  });
});

describe("buildChecklist", () => {
  it("bbフェーズでは現在フェーズのcountsのみ集計される", () => {
    const ipo = baseIpo({ listingDate: "2026-07-24" });
    const result = buildChecklist(ipo, "2026-07-20");
    expect(result.phase).toBe("bb");
    const bbSection = result.sections.find((s) => s.phase === "bb");
    expect(bbSection).toBeDefined();
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(bbSection!.items.length);
  });

  it("3フェーズ全セクションを返す", () => {
    const ipo = baseIpo();
    const result = buildChecklist(ipo, "2026-07-20");
    expect(result.sections.map((s) => s.phase)).toEqual(["bb", "listingDay", "secondary"]);
  });

  it("プライム以外の銘柄ではセカンダリーセクションにTOPIX項目が含まれない", () => {
    const ipo = baseIpo({ market: "グロース" });
    const result = buildChecklist(ipo, "2026-07-20");
    const secondary = result.sections.find((s) => s.phase === "secondary")!;
    expect(secondary.items.some((i) => i.id === "topix-inclusion")).toBe(false);
  });

  it("プライム銘柄ではセカンダリーセクションにTOPIX項目が含まれる", () => {
    const ipo = baseIpo({ market: "プライム" });
    const result = buildChecklist(ipo, "2026-07-20");
    const secondary = result.sections.find((s) => s.phase === "secondary")!;
    expect(secondary.items.some((i) => i.id === "topix-inclusion")).toBe(true);
  });
});
