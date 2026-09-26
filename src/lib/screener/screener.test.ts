import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import {
  applyScreener,
  EMPTY_CRITERIA,
  SCREENER_PRESETS,
  getPresetById,
  matchesAnyPreset,
  type ScreenerContext,
} from "./index";

// テスト用のベース銘柄。completeness.test.ts のスタイルに合わせる。
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

function ctx(overrides: Partial<ScreenerContext> = {}): ScreenerContext {
  return {
    watched: () => false,
    scored: new Map(),
    today: "2026-09-25",
    ...overrides,
  };
}

describe("applyScreener: プリセット「高成長×流動性」", () => {
  const preset = getPresetById("growthLiquidity");

  it("3条件すべて満たせば一致する", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 100,
        revenueGrowth: 30,
        operatingProfit: 10,
        isProfitable: true,
      },
      recentVolume: 500_000,
      initialPrice: 1000,
      currentPrice: 1000,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["TEST"]);
  });

  it("売上成長率が境界未満(29.9%)なら除外", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 100,
        revenueGrowth: 29.9,
        operatingProfit: 10,
        isProfitable: true,
      },
      recentVolume: 500_000,
      initialPrice: 1000,
      currentPrice: 1000,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("直近出来高が境界未満(499999株)なら除外", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 100,
        revenueGrowth: 30,
        operatingProfit: 10,
        isProfitable: true,
      },
      recentVolume: 499_999,
      initialPrice: 1000,
      currentPrice: 1000,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("現在値が初値未満なら除外", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 100,
        revenueGrowth: 30,
        operatingProfit: 10,
        isProfitable: true,
      },
      recentVolume: 500_000,
      initialPrice: 1000,
      currentPrice: 999,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("現在値・初値が未取得(null)なら除外", () => {
    const ipo = baseIpo({
      financials: {
        revenue: 100,
        revenueGrowth: 30,
        operatingProfit: 10,
        isProfitable: true,
      },
      recentVolume: 500_000,
      initialPrice: null,
      currentPrice: null,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });
});

describe("applyScreener: プリセット「BB参加候補」", () => {
  const preset = getPresetById("bbCandidate");

  it("status=bb_open・グロース・吸収金額30億・オファリングレシオ30%なら一致（境界値ちょうど）", () => {
    const ipo = baseIpo({
      status: "bb_open",
      market: "グロース",
      absorptionAmount: 30,
      offeringRatio: 30,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["TEST"]);
  });

  it("status=listedなら除外", () => {
    const ipo = baseIpo({ status: "listed", market: "グロース" });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("吸収金額が境界超(30.1億)なら除外", () => {
    const ipo = baseIpo({
      status: "upcoming",
      market: "グロース",
      absorptionAmount: 30.1,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("市場がスタンダードなら除外", () => {
    const ipo = baseIpo({ status: "upcoming", market: "スタンダード" });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });

  it("オファリングレシオ未取得(0)は除外しない", () => {
    const ipo = baseIpo({
      status: "priced",
      market: "グロース",
      offeringRatio: 0,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["TEST"]);
  });

  it("オファリングレシオが境界超(30.1%)なら除外", () => {
    const ipo = baseIpo({
      status: "priced",
      market: "グロース",
      offeringRatio: 30.1,
    });
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });
});

describe("applyScreener: プリセット「ウォッチ中」", () => {
  const preset = getPresetById("watchlist");

  it("ウォッチ中の銘柄のみ一致する", () => {
    const watchedIpo = baseIpo({ code: "AAAA" });
    const otherIpo = baseIpo({ code: "BBBB" });
    const result = applyScreener(
      [watchedIpo, otherIpo],
      preset.criteria,
      ctx({ watched: (code) => code === "AAAA" }),
    );
    expect(result.map((r) => r.ipo.code)).toEqual(["AAAA"]);
  });

  it("ウォッチが1件も無ければ結果は空", () => {
    const ipo = baseIpo();
    const result = applyScreener([ipo], preset.criteria, ctx());
    expect(result).toEqual([]);
  });
});

describe("applyScreener: 手動条件", () => {
  it("VC比率上限は境界ちょうどなら一致・境界超なら除外", () => {
    const atLimit = baseIpo({ code: "AT", vcRatio: 40 });
    const overLimit = baseIpo({ code: "OVER", vcRatio: 40.1 });
    const criteria = { ...EMPTY_CRITERIA, maxVcRatio: 40 };
    const result = applyScreener([atLimit, overLimit], criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["AT"]);
  });

  it("黒字のみtoggleで赤字銘柄を除外する", () => {
    const profitable = baseIpo({
      code: "P",
      financials: {
        revenue: 100,
        revenueGrowth: 0,
        operatingProfit: 10,
        isProfitable: true,
      },
    });
    const unprofitable = baseIpo({
      code: "U",
      financials: {
        revenue: 100,
        revenueGrowth: 0,
        operatingProfit: -10,
        isProfitable: false,
      },
    });
    const criteria = { ...EMPTY_CRITERIA, profitableOnly: true };
    const result = applyScreener([profitable, unprofitable], criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["P"]);
  });

  it("上場からの日数上限は境界ちょうどなら一致・境界超なら除外", () => {
    // today=2026-09-25 とすると 2026-09-15 は10日前、2026-09-14 は11日前。
    const atLimit = baseIpo({ code: "AT", listingDate: "2026-09-15" });
    const overLimit = baseIpo({ code: "OVER", listingDate: "2026-09-14" });
    const criteria = { ...EMPTY_CRITERIA, maxDaysSinceListing: 10 };
    const result = applyScreener(
      [atLimit, overLimit],
      criteria,
      ctx({ today: "2026-09-25" }),
    );
    expect(result.map((r) => r.ipo.code)).toEqual(["AT"]);
  });

  it("上場日が未来（未上場）なら日数上限条件で除外される", () => {
    const future = baseIpo({ code: "FUTURE", listingDate: "2026-10-01" });
    const criteria = { ...EMPTY_CRITERIA, maxDaysSinceListing: 10 };
    const result = applyScreener(
      [future],
      criteria,
      ctx({ today: "2026-09-25" }),
    );
    expect(result).toEqual([]);
  });

  it("市場フィルタは複数選択でOR条件になる", () => {
    const growth = baseIpo({ code: "G", market: "グロース" });
    const standard = baseIpo({ code: "S", market: "スタンダード" });
    const prime = baseIpo({ code: "PR", market: "プライム" });
    const criteria = {
      ...EMPTY_CRITERIA,
      markets: ["グロース", "スタンダード"] as const,
    };
    const result = applyScreener(
      [growth, standard, prime],
      { ...criteria, markets: [...criteria.markets] },
      ctx(),
    );
    expect(result.map((r) => r.ipo.code).sort()).toEqual(["G", "S"]);
  });

  it("吸収金額上限0でも吸収金額0の銘柄は境界一致で通る", () => {
    const zero = baseIpo({ code: "Z", absorptionAmount: 0 });
    const criteria = { ...EMPTY_CRITERIA, maxAbsorptionAmount: 0 };
    const result = applyScreener([zero], criteria, ctx());
    expect(result.map((r) => r.ipo.code)).toEqual(["Z"]);
  });
});

describe("applyScreener: 並び順", () => {
  it("スコア対象銘柄は総合スコア降順、insufficient銘柄は末尾に上場日順で並ぶ", () => {
    const high = baseIpo({ code: "HIGH", listingDate: "2026-09-01" });
    const low = baseIpo({ code: "LOW", listingDate: "2026-09-02" });
    const insufficientEarly = baseIpo({
      code: "INSUF-EARLY",
      listingDate: "2026-08-01",
    });
    const insufficientLate = baseIpo({
      code: "INSUF-LATE",
      listingDate: "2026-08-15",
    });

    const scored = new Map([
      ["HIGH", { supply: 80, funda: 80, overall: 80 }],
      ["LOW", { supply: 40, funda: 40, overall: 40 }],
    ]);

    const result = applyScreener(
      [low, insufficientLate, high, insufficientEarly],
      EMPTY_CRITERIA,
      ctx({ scored }),
    );

    expect(result.map((r) => r.ipo.code)).toEqual([
      "HIGH",
      "LOW",
      "INSUF-EARLY",
      "INSUF-LATE",
    ]);
    expect(result.find((r) => r.ipo.code === "HIGH")?.insufficient).toBe(
      false,
    );
    expect(
      result.find((r) => r.ipo.code === "INSUF-EARLY")?.insufficient,
    ).toBe(true);
  });
});

describe("matchesAnyPreset", () => {
  it("プリセットと同一条件ならそのIDを返す", () => {
    for (const preset of SCREENER_PRESETS) {
      expect(matchesAnyPreset(preset.criteria)).toBe(preset.id);
    }
  });

  it("プリセットから1項目でも変えるとカスタム（null）になる", () => {
    const preset = getPresetById("growthLiquidity");
    const customized = { ...preset.criteria, minRevenueGrowth: 50 };
    expect(matchesAnyPreset(customized)).toBeNull();
  });

  it("何も条件が無い(EMPTY_CRITERIA)ならどのプリセットにも一致しない", () => {
    expect(matchesAnyPreset(EMPTY_CRITERIA)).toBeNull();
  });
});
