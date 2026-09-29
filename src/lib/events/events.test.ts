import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import {
  CALENDAR_EVENT_LABELS,
  firstEarningsEvent,
  groupEventsByDate,
  lockupExpiryEvent,
  priceReleaseWatchEvent,
  recentLargeHoldingReports,
  upcomingCalendarEvents,
} from "./index";

// home.test.ts のスタイルに合わせたベース銘柄ビルダー。
function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
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

const TODAY = "2026-09-25";

describe("upcomingCalendarEvents", () => {
  it("BB開始・BB締切・抽選・購入期間開始・購入期限・上場の6種を生成する", () => {
    const ipo = baseIpo({
      code: "A001",
      bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
      allotmentDate: "2026-10-05",
      purchasePeriod: { start: "2026-10-06", end: "2026-10-09" },
      listingDate: "2026-10-14",
    });
    const events = upcomingCalendarEvents([ipo], TODAY);
    expect(events.map((e) => [e.kind, e.date])).toEqual([
      ["bbStart", "2026-09-29"],
      ["bbEnd", "2026-10-02"],
      ["allotment", "2026-10-05"],
      ["purchaseStart", "2026-10-06"],
      ["purchaseEnd", "2026-10-09"],
      ["listing", "2026-10-14"],
    ]);
    expect(events[0].detail).toContain("2026/09/29〜2026/10/02");
  });

  it("上場後3種（ロック解除・1.5倍ライン監視・初決算）を含める", () => {
    const ipo = baseIpo({
      code: "B001",
      status: "listed",
      listingDate: "2026-07-01",
      lockup: { days: 90, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 1000,
      currentPrice: 1450,
      firstEarningsDate: "2026-11-13",
    });
    const kinds = upcomingCalendarEvents([ipo], TODAY).map((e) => e.kind);
    expect(kinds).toEqual(["priceReleaseWatch", "lockupExpiry", "firstEarnings"]);
  });

  it("期間外（過去日・91日以降）は除外し、今日と90日目は含める", () => {
    const ipo = baseIpo({
      code: "C001",
      bbPeriod: { start: "2026-09-24", end: TODAY },
      listingDate: "2026-12-24", // today+90
      firstEarningsDate: "2026-12-25", // today+91
    });
    const events = upcomingCalendarEvents([ipo], TODAY);
    expect(events.map((e) => [e.kind, e.date])).toEqual([
      ["bbEnd", TODAY],
      ["listing", "2026-12-24"],
    ]);
  });

  it("days 引数で対象期間を変えられる", () => {
    const ipo = baseIpo({ listingDate: "2026-10-20" });
    expect(upcomingCalendarEvents([ipo], TODAY, 14)).toEqual([]);
    expect(upcomingCalendarEvents([ipo], TODAY, 30)).toHaveLength(1);
  });

  it("複数銘柄を日付昇順に並べ、同日は種別順→コード順", () => {
    const a = baseIpo({ code: "Z999", listingDate: "2026-10-10" });
    const b = baseIpo({ code: "A111", listingDate: "2026-10-10" });
    const c = baseIpo({ code: "M555", bbPeriod: { start: "2026-10-10", end: "" } });
    const d = baseIpo({ code: "Q000", firstEarningsDate: "2026-10-01" });
    const events = upcomingCalendarEvents([a, b, c, d], TODAY);
    expect(events.map((e) => `${e.date}:${e.kind}:${e.ipo.code}`)).toEqual([
      "2026-10-01:firstEarnings:Q000",
      "2026-10-10:bbStart:M555",
      "2026-10-10:listing:A111",
      "2026-10-10:listing:Z999",
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].date <= events[i].date).toBe(true);
    }
  });

  it("todayIso が不正なら空配列", () => {
    expect(upcomingCalendarEvents([baseIpo({ listingDate: TODAY })], "")).toEqual([]);
  });
});

describe("lockupExpiryEvent", () => {
  it("listingDate + lockup.days を解除日として返す", () => {
    const ipo = baseIpo({
      listingDate: "2026-07-01",
      lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
    });
    const event = lockupExpiryEvent(ipo, TODAY);
    expect(event?.kind).toBe("lockupExpiry");
    expect(event?.date).toBe("2026-12-28");
  });

  it("lockup.days=0 は除外する", () => {
    const ipo = baseIpo({ listingDate: "2026-09-01" });
    expect(lockupExpiryEvent(ipo, TODAY)).toBeNull();
    expect(
      upcomingCalendarEvents([ipo], TODAY).some((e) => e.kind === "lockupExpiry"),
    ).toBe(false);
  });

  it("listingDate が空、または解除日が過去なら null", () => {
    const noListing = baseIpo({
      lockup: { days: 90, hasPriceRelease: false, coverage: 60 },
    });
    expect(lockupExpiryEvent(noListing, TODAY)).toBeNull();
    const passed = baseIpo({
      listingDate: "2026-06-01",
      lockup: { days: 90, hasPriceRelease: false, coverage: 60 },
    });
    expect(lockupExpiryEvent(passed, TODAY)).toBeNull();
  });
});

describe("priceReleaseWatchEvent", () => {
  const listed = (overrides: Partial<Ipo>) =>
    baseIpo({
      status: "listed",
      listingDate: "2026-09-01",
      lockup: { days: 90, hasPriceRelease: true, coverage: 60 },
      offeringPrice: 1000,
      ...overrides,
    });

  it("直近終値が公開価格の1.4倍以上で今日付の監視イベントを返す（境界含む）", () => {
    const event = priceReleaseWatchEvent(listed({ currentPrice: 1400 }), TODAY);
    expect(event?.kind).toBe("priceReleaseWatch");
    expect(event?.date).toBe(TODAY);
    expect(event?.detail).toContain("1,500円");
    expect(event?.detail).toContain("接近");
  });

  it("1.4倍未満は null", () => {
    expect(priceReleaseWatchEvent(listed({ currentPrice: 1399 }), TODAY)).toBeNull();
  });

  it("1.5倍以上は「到達圏」として返す", () => {
    const event = priceReleaseWatchEvent(listed({ currentPrice: 1600 }), TODAY);
    expect(event?.detail).toContain("到達圏");
  });

  it("解除条項なし・価格データ不足・ロックアップ終了済みは null", () => {
    expect(
      priceReleaseWatchEvent(
        listed({
          currentPrice: 1500,
          lockup: { days: 90, hasPriceRelease: false, coverage: 60 },
        }),
        TODAY,
      ),
    ).toBeNull();
    expect(priceReleaseWatchEvent(listed({ currentPrice: null }), TODAY)).toBeNull();
    expect(
      priceReleaseWatchEvent(listed({ currentPrice: 1500, offeringPrice: null }), TODAY),
    ).toBeNull();
    expect(
      priceReleaseWatchEvent(
        listed({ currentPrice: 1500, listingDate: "2026-05-01" }),
        TODAY,
      ),
    ).toBeNull();
  });

  it("株式分割後は直近終値を上場時の単位に直して判定する", () => {
    // 1:2 分割後の終値 700円 = 上場時の単位 1,400円（公開価格の1.40倍）。
    const event = priceReleaseWatchEvent(listed({ currentPrice: 700, splitFactor: 2 }), TODAY);
    expect(event?.detail).toContain("直近終値700円（公開価格の1.40倍）");
    // 1.5倍ラインは直近終値と同じ現在の単位（1,500円÷2）で示す。
    expect(event?.detail).toContain("1.5倍ライン750円（分割換算後）に接近");
    // 分割後の単位のまま公開価格と比べる誤判定（0.7倍）は起きない。
    expect(priceReleaseWatchEvent(listed({ currentPrice: 699, splitFactor: 2 }), TODAY)).toBeNull();
    // 分割を知らなければ 700円は 0.7倍で監視対象外。
    expect(priceReleaseWatchEvent(listed({ currentPrice: 700 }), TODAY)).toBeNull();
  });
});

describe("firstEarningsEvent", () => {
  it("firstEarningsDate があれば返し、無ければ null", () => {
    expect(firstEarningsEvent(baseIpo({ firstEarningsDate: "2026-11-13" }))?.date).toBe(
      "2026-11-13",
    );
    expect(firstEarningsEvent(baseIpo({ firstEarningsDate: null }))).toBeNull();
    expect(firstEarningsEvent(baseIpo())).toBeNull();
  });
});

describe("recentLargeHoldingReports", () => {
  it("直近30日以内（両端含む）の提出だけを新しい順で返す", () => {
    const ipos = [
      baseIpo({ code: "L1", largeHoldingReport: { date: "2026-08-26", holder: "A社" } }), // 30日前
      baseIpo({ code: "L2", largeHoldingReport: { date: "2026-08-25", holder: "B社" } }), // 31日前
      baseIpo({ code: "L3", largeHoldingReport: { date: "2026-09-20", holder: "C社" } }),
      baseIpo({ code: "L4", largeHoldingReport: { date: "2026-09-26", holder: "D社" } }), // 未来
      baseIpo({ code: "L5", largeHoldingReport: null }),
    ];
    const events = recentLargeHoldingReports(ipos, TODAY);
    expect(events.map((e) => e.ipo.code)).toEqual(["L3", "L1"]);
    expect(events[0].kind).toBe("largeHoldingReport");
    expect(events[0].detail).toContain("C社");
  });

  it("upcomingCalendarEvents には含めない", () => {
    const ipo = baseIpo({ largeHoldingReport: { date: TODAY, holder: "A社" } });
    expect(upcomingCalendarEvents([ipo], TODAY)).toEqual([]);
  });
});

describe("groupEventsByDate / ラベル", () => {
  it("同じ日付を1グループにまとめる", () => {
    const events = upcomingCalendarEvents(
      [
        baseIpo({ code: "G1", listingDate: "2026-10-01" }),
        baseIpo({ code: "G2", listingDate: "2026-10-01" }),
        baseIpo({ code: "G3", listingDate: "2026-10-02" }),
      ],
      TODAY,
    );
    const groups = groupEventsByDate(events);
    expect(groups.map((g) => [g.date, g.events.length])).toEqual([
      ["2026-10-01", 2],
      ["2026-10-02", 1],
    ]);
  });

  it("全種別にラベルがある", () => {
    expect(Object.keys(CALENDAR_EVENT_LABELS)).toHaveLength(10);
    for (const label of Object.values(CALENDAR_EVENT_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
