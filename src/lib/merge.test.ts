import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { IpoAuto } from "@/types/data";
import type { IpoEnriched } from "@/types/enriched";
import {
  applyEnriched,
  derivePriceRangePosition,
  mergeIpos,
  skeletonFromAuto,
} from "./merge";

// 手動情報がそろった base 銘柄。completeness.test.ts のスタイルに合わせる。
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
    underwriters: ["SBI証券", "楽天証券"],
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

// CSV 由来で未取得項目が既定値のままの base 銘柄。
function sparseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return baseIpo({
    bbPeriod: { start: "", end: "" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
    priceRange: { low: 0, high: 0 },
    offeringPrice: null,
    publicShares: 0,
    saleShares: 0,
    overAllotment: 0,
    absorptionAmount: 0,
    offeringRatio: 0,
    marketCap: 0,
    vcRatio: 0,
    lockup: { days: 0, hasPriceRelease: false, coverage: 0 },
    underwriters: ["SBI証券"],
    financials: {
      revenue: 0,
      revenueGrowth: 0,
      operatingProfit: 0,
      isProfitable: false,
    },
    ...overrides,
  });
}

const URL = "https://kabu.96ut.com/article/ipo/2026035/";
const FETCHED = "2026-09-25T08:00:00.000Z";

function enrichedFull(overrides: Partial<IpoEnriched> = {}): IpoEnriched {
  return {
    code: "TEST",
    articleUrl: URL,
    fetchedAt: FETCHED,
    sources: { bbPeriod: { url: URL, fetchedAt: FETCHED } },
    bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
    allotmentDate: "2026-10-05",
    purchasePeriod: { start: "2026-10-06", end: "2026-10-09" },
    assumedPrice: 1300,
    priceRange: { low: 1200, high: 1400 },
    offeringPrice: 1400,
    publicShares: 400000,
    saleShares: 600000,
    overAllotment: 150000,
    issuedShares: 5000000,
    offeringRatio: 23,
    absorptionAmount: 16.1,
    marketCap: 70,
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券", "みずほ証券", "楽天証券"],
    financials: {
      revenue: 3000,
      revenueGrowth: 15,
      operatingProfit: 300,
      isProfitable: true,
    },
    vcRatio: 12,
    lockup: { days: 90, hasPriceRelease: true, coverage: 70 },
    ...overrides,
  };
}

describe("mergeIpos（後方互換）", () => {
  const base = [baseIpo(), sparseIpo({ code: "SPRS" })];
  const auto: IpoAuto[] = [
    { code: "TEST", initialPrice: 1500, status: "listed" },
    { code: "NEW1", name: "新規発見", listingDate: "2026-10-20" },
  ];

  it("enriched 省略時と空配列指定時は同一結果", () => {
    expect(mergeIpos(base, auto, [])).toEqual(mergeIpos(base, auto));
  });

  it("enriched 省略時は従来どおり auto だけが反映される", () => {
    const result = mergeIpos(base, auto);
    expect(result.map((r) => r.code)).toEqual(["TEST", "SPRS", "NEW1"]);
    expect(result[0].initialPrice).toBe(1500);
    expect(result[0].status).toBe("listed");
    // auto の無い base 銘柄は同一オブジェクトのまま（従来挙動）
    expect(result[1]).toBe(base[1]);
    expect(result[2]).toEqual(skeletonFromAuto(auto[1]));
  });
});

describe("applyEnriched", () => {
  it("base の既定値フィールドが enriched で埋まる", () => {
    const merged = applyEnriched(sparseIpo(), enrichedFull());
    expect(merged.bbPeriod).toEqual({ start: "2026-09-29", end: "2026-10-02" });
    expect(merged.allotmentDate).toBe("2026-10-05");
    expect(merged.purchasePeriod).toEqual({
      start: "2026-10-06",
      end: "2026-10-09",
    });
    expect(merged.priceRange).toEqual({ low: 1200, high: 1400 });
    expect(merged.offeringPrice).toBe(1400);
    expect(merged.publicShares).toBe(400000);
    expect(merged.saleShares).toBe(600000);
    expect(merged.overAllotment).toBe(150000);
    expect(merged.offeringRatio).toBe(23);
    expect(merged.absorptionAmount).toBe(16.1);
    expect(merged.marketCap).toBe(70);
    expect(merged.underwriters).toEqual(["SBI証券", "みずほ証券", "楽天証券"]);
    expect(merged.financials.revenueGrowth).toBe(15);
    expect(merged.vcRatio).toBe(12);
    expect(merged.lockup).toEqual({
      days: 90,
      hasPriceRelease: true,
      coverage: 70,
    });
  });

  it("base の手動入力値は enriched で上書きされない", () => {
    const base = baseIpo();
    const merged = applyEnriched(base, enrichedFull());
    expect(merged).toEqual(base);
  });

  it("enriched が undefined なら base をそのまま返す", () => {
    const base = sparseIpo();
    expect(applyEnriched(base, undefined)).toBe(base);
  });

  it("enriched 側に値が無いフィールドは既定値のまま", () => {
    const merged = applyEnriched(sparseIpo(), {
      code: "TEST",
      articleUrl: URL,
      fetchedAt: FETCHED,
      sources: {},
      offeringPrice: null,
    });
    expect(merged).toEqual(sparseIpo());
  });

  it("元の base オブジェクトを破壊しない", () => {
    const base = sparseIpo();
    const snapshot = structuredClone(base);
    applyEnriched(base, enrichedFull());
    expect(base).toEqual(snapshot);
  });

  it("OR 未記載なら発行済株数から再計算し、仮条件未発表ならenriched の想定価格を採用", () => {
    const merged = applyEnriched(
      sparseIpo(),
      enrichedFull({ offeringRatio: undefined, priceRange: undefined }),
    );
    // (400,000 + 600,000) / 5,000,000 = 20%
    expect(merged.offeringRatio).toBe(20);
    expect(merged.priceRange).toEqual({ low: 1300, high: 1300 });
  });

  it("主幹事が未設定なら enriched の主幹事を入れ、幹事団は重複排除で統合", () => {
    const merged = applyEnriched(
      sparseIpo({ leadUnderwriter: "", underwriters: [] }),
      enrichedFull({
        leadUnderwriter: "みずほ証券",
        underwriters: ["SBI証券", "みずほ証券"],
      }),
    );
    expect(merged.leadUnderwriter).toBe("みずほ証券");
    expect(merged.underwriters).toEqual(["みずほ証券", "SBI証券"]);
  });

  it("公開価格ベースの吸収金額が無いときは想定ベースへフォールバックする", () => {
    const merged = applyEnriched(
      sparseIpo(),
      enrichedFull({
        offeringPrice: null,
        absorptionAmount: undefined,
        absorptionAmountAssumed: 52.2,
      }),
    );
    expect(merged.absorptionAmount).toBe(52.2);

    // 公開価格ベースがあればそちらを優先する。
    const preferred = applyEnriched(
      sparseIpo(),
      enrichedFull({ absorptionAmount: 16.1, absorptionAmountAssumed: 52.2 }),
    );
    expect(preferred.absorptionAmount).toBe(16.1);
  });
});

describe("applyEnriched（CSV 仮置きの仮条件）", () => {
  const enriched: IpoEnriched = {
    code: "PLC1",
    articleUrl: "https://kabu.96ut.com/article/ipo/2026001/",
    fetchedAt: "2026-09-25T00:00:00.000Z",
    sources: {},
    assumedPrice: 1000,
    priceRange: { low: 1000, high: 1200 },
  };

  it("想定価格・仮条件・公開価格が同値の仮置きは enriched の実値で置き換え、位置を導出する", () => {
    const base = baseIpo({
      code: "PLC1",
      assumedPrice: 1200,
      priceRange: { low: 1200, high: 1200 },
      offeringPrice: 1200,
      priceRangePosition: null,
    });
    const merged = applyEnriched(base, enriched);
    expect(merged.assumedPrice).toBe(1000);
    expect(merged.priceRange).toEqual({ low: 1000, high: 1200 });
    expect(merged.priceRangePosition).toBe("upper");
  });

  it("手動入力された仮条件（上下限が異なる）は置き換えない", () => {
    const base = baseIpo({
      code: "PLC1",
      assumedPrice: 1500,
      priceRange: { low: 1400, high: 1600 },
      offeringPrice: 1600,
      priceRangePosition: "upper",
    });
    const merged = applyEnriched(base, enriched);
    expect(merged.assumedPrice).toBe(1500);
    expect(merged.priceRange).toEqual({ low: 1400, high: 1600 });
    expect(merged.priceRangePosition).toBe("upper");
  });

  it("公開価格未定なら位置は null のまま", () => {
    const base = baseIpo({
      code: "PLC1",
      assumedPrice: 0,
      priceRange: { low: 0, high: 0 },
      offeringPrice: null,
      priceRangePosition: null,
    });
    const merged = applyEnriched(base, enriched);
    expect(merged.priceRange).toEqual({ low: 1000, high: 1200 });
    expect(merged.priceRangePosition).toBeNull();
  });

  it("enriched に想定価格だけあり仮条件が無ければ、仮置きレンジも想定価格の low=high に揃える", () => {
    const base = baseIpo({
      code: "PLC1",
      assumedPrice: 1200,
      priceRange: { low: 1200, high: 1200 },
      offeringPrice: 1200,
      priceRangePosition: null,
    });
    const assumedOnly: IpoEnriched = {
      code: "PLC1",
      articleUrl: "https://kabu.96ut.com/article/ipo/2026001/",
      fetchedAt: "2026-09-25T00:00:00.000Z",
      sources: {},
      assumedPrice: 900,
    };
    const merged = applyEnriched(base, assumedOnly);
    expect(merged.assumedPrice).toBe(900);
    expect(merged.priceRange).toEqual({ low: 900, high: 900 });
    // レンジ未取得（上下限同値）なので位置は導出しない。
    expect(merged.priceRangePosition).toBeNull();
  });
});

describe("derivePriceRangePosition（境界）", () => {
  const range = { low: 1000, high: 1200 };

  it("公開価格＝下限なら lower", () => {
    expect(derivePriceRangePosition(1000, range)).toBe("lower");
  });

  it("公開価格＝上限なら upper", () => {
    expect(derivePriceRangePosition(1200, range)).toBe("upper");
  });

  it("レンジ内なら middle", () => {
    expect(derivePriceRangePosition(1100, range)).toBe("middle");
  });

  it("上下限同値・公開価格未定は null", () => {
    expect(derivePriceRangePosition(1000, { low: 1000, high: 1000 })).toBeNull();
    expect(derivePriceRangePosition(null, range)).toBeNull();
  });
});

describe("mergeIpos + enriched", () => {
  it("スケルトン（JPX 新規発見）にも enriched が適用され、auto の価格系も残る", () => {
    const auto: IpoAuto[] = [
      {
        code: "648A",
        name: "ルクレ",
        listingDate: "2026-10-14",
        status: "upcoming",
      },
    ];
    const [result] = mergeIpos([], auto, [enrichedFull({ code: "648A" })]);
    expect(result.name).toBe("ルクレ");
    expect(result.bbPeriod.start).toBe("2026-09-29");
    expect(result.absorptionAmount).toBe(16.1);
    expect(result.offeringPrice).toBe(1400);
    expect(result.assumedPrice).toBe(1300);
    expect(result.status).toBe("upcoming");
  });

  it("処理順は base → enriched → auto（auto の初値・status 前進が enriched の後に乗る）", () => {
    const base = [sparseIpo()];
    const auto: IpoAuto[] = [
      { code: "TEST", initialPrice: 2000, status: "listed" },
    ];
    const [result] = mergeIpos(base, auto, [enrichedFull()]);
    expect(result.offeringPrice).toBe(1400);
    expect(result.initialPrice).toBe(2000);
    expect(result.status).toBe("listed");
  });

  it("base にも auto にも無い enriched は追加しない", () => {
    const result = mergeIpos([baseIpo()], [], [enrichedFull({ code: "ZZZZ" })]);
    expect(result.map((r) => r.code)).toEqual(["TEST"]);
  });
});
