import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Ipo } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import type { BbPick } from "@/lib/picks/bb";
import { HomeClient } from "@/components/home/HomeClient";
import { BbPicksPanel } from "./BbPicksPanel";

function ipo(code: string, overrides: Partial<Ipo> = {}): Ipo {
  return {
    code,
    name: `銘柄${code}`,
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "2026-10-15",
    bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    absorptionAmount: 52.2,
    offeringRatio: 20,
    marketCap: 100,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
    leadUnderwriter: "野村證券",
    underwriters: ["野村證券"],
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

function render(picks: BbPick[]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<BbPicksPanel picks={picks} />);
  return container;
}

describe("BbPicksPanel", () => {
  it("順位・受付状況・理由・指標の帯・公募割れを出し、行は銘柄詳細へ", () => {
    const container = render([
      {
        ipo: ipo("648A"),
        phase: "open",
        bbScore: 72,
        breakEvenProbability: 0.291,
        reasons: [
          { key: "vcLockup", text: "VC 0% / ロック180日", tone: "good" },
          { key: "saleRatio", text: "売出比率 85%", tone: "bad" },
        ],
      },
      {
        ipo: ipo("650A", { bbPeriod: { start: "2026-10-06", end: "2026-10-09" }, absorptionAmount: 0, offeringPrice: 1200 }),
        phase: "before",
        bbScore: 40,
        breakEvenProbability: null,
        reasons: [],
      },
    ]);
    const rows = [...container.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/ipo/648A");
    expect(rows[0].textContent).toContain("受付中10/2まで");
    expect(rows[0].textContent).toContain("主幹事 野村證券");
    expect(rows[0].textContent).toContain("VC 0% / ロック180日");
    expect(rows[0].textContent).toContain("売出比率 85%");
    expect(rows[0].textContent).toContain("9/29〜10/2");
    expect(rows[0].textContent).toContain("52.2億円");
    expect(rows[0].textContent).toContain("29%");
    expect(rows[0].textContent).toContain("72");
    expect(rows[1].textContent).toContain("受付前10/6から");
    // 吸収金額・公募割れが分からない銘柄は「—」
    expect(rows[1].textContent).toContain("—");
    expect(container.textContent).toContain("受付中 1・受付前 1");
    expect(container.querySelector('a[href="/bb"]')?.textContent).toBe("BB 管理へ");
  });

  it("共通チェックの集計と即金規制の可能性を出す", () => {
    const container = render([
      {
        ipo: ipo("648A"),
        phase: "open",
        bbScore: 72,
        breakEvenProbability: null,
        reasons: [],
        checkCounts: { pass: 5, warn: 2, fail: 1, unknown: 1 },
        instantCash: "likely",
      },
    ]);
    const row = container.querySelector("ol > li");
    expect(row?.textContent).toContain("✓5");
    expect(row?.textContent).toContain("△2");
    expect(row?.textContent).toContain("✗1");
    expect(row?.textContent).toContain("即金規制の可能性");
  });

  it("対象が無いときは、その旨と BB 管理への導線だけ", () => {
    const container = render([]);
    expect(container.querySelectorAll("ol > li")).toHaveLength(0);
    expect(container.textContent).toContain("いま BB を受け付けている銘柄・これから受け付ける銘柄はありません");
    expect(container.querySelector('a[href="/bb"]')).not.toBeNull();
  });
});

describe("HomeClient のピックアップ（手法の切り替え）", () => {
  const market = { sentiment: "neutral" } as MarketData;
  const bbIpo = ipo("648A");
  const bbPicks = [
    { code: "648A", phase: "open" as const, underwriterStat: null, context: {}, breakEvenProbability: 0.2 },
  ];

  function renderHome(initialMethod: "bb" | "short" | "mid" | "holdings" | "yutai") {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <HomeClient
        ipos={[bbIpo]}
        market={market}
        todayIso="2026-09-30"
        hot={null}
        initialTab="hot"
        bbPicks={bbPicks}
        initialMethod={initialMethod}
      />,
    );
    return container;
  }

  it("上部タブの先頭は「ピックアップ」、中の切り替えは BB・短期セカンダリ・中長期セカンダリ・大量保有・優待の順", () => {
    const container = renderHome("bb");
    const tablists = container.querySelectorAll('[role="tablist"]');
    expect(tablists).toHaveLength(2);
    expect(tablists[0].querySelector('[role="tab"]')?.textContent).toBe("ピックアップ");
    expect([...tablists[1].querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      "BB",
      "短期セカンダリ",
      "中長期セカンダリ",
      "大量保有",
      "優待",
    ]);
  });

  it.each([
    ["bb", "BB", "BB スコア順"],
    ["short", "短期セカンダリ", "チェックのクリア数順"],
    ["mid", "中長期セカンダリ", "注目度ランキング"],
    ["holdings", "大量保有", "大量保有報告書"],
    ["yutai", "優待", "権利付最終日"],
  ] as const)("initialMethod=%s で %s を選び、その中身を出す", (method, label, text) => {
    const container = renderHome(method);
    const selected = container.querySelectorAll('[role="tablist"]')[1].querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toBe(label);
    expect(container.textContent).toContain(text);
  });
});
