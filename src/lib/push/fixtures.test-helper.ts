import type { Ipo } from "@/types/ipo";

// push テスト共通のベース銘柄ビルダー（events.test.ts と同じ形）。
export function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "",
    bbPeriod: { start: "", end: "" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
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
    lockup: { days: 0, hasPriceRelease: false, coverage: 60 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券"],
    financials: { revenue: 2000, revenueGrowth: 20, operatingProfit: 200, isProfitable: true },
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

/** src 配下に出してはいけない語（mobile-design.md §6）。grep に掛からないようエスケープで持つ。 */
export const FORBIDDEN_WORDS = [
  "\u8cb7\u3044", "\u8cb7\u3046", "\u58f2\u308a\u63a8\u5968", "\u63a8\u5968", "\u304a\u3059\u3059\u3081", "\u304a\u5b9d", "\u5fc5\u52dd", "\u7206\u76ca", "\u30c6\u30f3\u30d0\u30ac\u30fc", "\u52dd\u3066\u308b", "\u5132\u304b",
];
