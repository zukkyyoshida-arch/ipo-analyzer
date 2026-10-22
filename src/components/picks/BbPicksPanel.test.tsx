import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
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

  it("1カード1結論: 結論バッジ1個と根拠の1行を出し、チップ・指標は閉じた Disclosure に畳む", () => {
    const container = render([
      {
        ipo: ipo("648A"),
        phase: "open",
        bbScore: 72,
        breakEvenProbability: 0.12,
        reasons: [{ key: "vcLockup", text: "VC 0% / ロック180日", tone: "good" }],
        checkCounts: { pass: 6, warn: 1, fail: 1, unknown: 1 },
      },
      {
        ipo: ipo("650A"),
        phase: "open",
        bbScore: 48,
        breakEvenProbability: 0.41,
        reasons: [],
        checkCounts: { pass: 3, warn: 2, fail: 3, unknown: 1 },
      },
      {
        ipo: ipo("651A"),
        phase: "before",
        bbScore: 30,
        breakEvenProbability: 0.5,
        reasons: [],
      },
    ]);
    const cards = [...container.querySelectorAll("ol > li")];
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("参加候補");
    expect(cards[0].textContent).toContain("BB 72 ・ 公募割れ 12% ・ ✗1");
    expect(cards[1].textContent).toContain("様子見");
    expect(cards[1].textContent).toContain("BB 48 ・ 公募割れ 41% ・ ✗3");
    expect(cards[2].textContent).toContain("見送り");
    expect(cards[2].textContent).toContain("BB 30 ・ 公募割れ 50%");
    // チップ・指標の表は畳む（既定は閉じる）
    const details = cards[0].querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("VC 0% / ロック180日");
    expect(details?.textContent).toContain("吸収金額");
    // 見出し行は銘柄詳細へ
    expect(cards[0].querySelector("a")?.getAttribute("href")).toBe("/ipo/648A");
    // 免責・基準の説明は見出しの ⓘ（閉じたシート）に退避している。
    expect(container.textContent).not.toContain("判断材料であり売買推奨ではありません。");
    expect(container.querySelector('button[aria-label="説明を見る"]')).not.toBeNull();
  });

  it("対象が無いときは、その旨と BB 管理への導線だけ", () => {
    const container = render([]);
    expect(container.querySelectorAll("ol > li")).toHaveLength(0);
    expect(container.textContent).toContain("いま BB を受け付けている銘柄・これから受け付ける銘柄はありません");
    expect(container.querySelector('a[href="/bb"]')).not.toBeNull();
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mk(code: string, o: Partial<BbPick> & { listing?: string; abs?: number } = {}): BbPick {
  const { listing, abs, ...rest } = o;
  return {
    ipo: ipo(code, { listingDate: listing ?? "2026-10-15", absorptionAmount: abs ?? 50 }),
    phase: "open",
    bbScore: 70,
    breakEvenProbability: 0.2,
    reasons: [],
    ...rest,
  };
}

describe("BbPicksPanel の順位付き絞り込み", () => {
  const picks: BbPick[] = [
    mk("A001", { bbScore: 80, breakEvenProbability: 0.2, listing: "2026-10-20", abs: 90, checkCounts: { pass: 6, warn: 1, fail: 0, unknown: 0 } }),
    mk("B002", { bbScore: 65, breakEvenProbability: 0.05, phase: "before", listing: "2026-10-10", abs: 10, instantCash: "likely" }),
    mk("C003", { bbScore: 40, breakEvenProbability: 0.6, listing: "2026-10-25", abs: 30 }),
  ];

  async function mount() {
    localStorage.clear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<BbPicksPanel picks={picks} />);
    });
    return { container, root };
  }
  const codes = (c: HTMLElement) => [...c.querySelectorAll("ol > li")].map((li) => li.querySelector("a")?.getAttribute("href"));
  const ranks = (c: HTMLElement) => [...c.querySelectorAll("ol > li")].map((li) => li.textContent?.match(/^[A-Z0-9]{4}(\d+)\./)?.[1]);
  const click = async (c: HTMLElement, label: string) => {
    const b = [...c.querySelectorAll("button")].find((x) => x.textContent === label);
    await act(async () => {
      b!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("全件を順位付きで出し、全 N 銘柄 → 表示 M 銘柄の行がある", async () => {
    const { container, root } = await mount();
    expect(codes(container)).toEqual(["/ipo/A001", "/ipo/B002", "/ipo/C003"]);
    expect(container.textContent).toContain("全 3銘柄 → 表示 3銘柄");
    await act(async () => root.unmount());
  });

  it("チップで絞ると行は減るが、順位の数字は元のまま", async () => {
    const { container, root } = await mount();
    await click(container, "受付前");
    expect(codes(container)).toEqual(["/ipo/B002"]);
    expect(container.textContent).toContain("全 3銘柄 → 表示 1銘柄");
    expect(container.querySelector("ol > li")?.textContent).toMatch(/^B0022\./);
    await click(container, "解除");
    await click(container, "スコア60以上");
    expect(codes(container)).toEqual(["/ipo/A001", "/ipo/B002"]);
    await act(async () => root.unmount());
  });

  it("並び替えても順位の数字は固定", async () => {
    const { container, root } = await mount();
    const select = container.querySelector("select")!;
    const setSort = async (v: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
        setter.call(select, v);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await setSort("breakEven");
    expect(codes(container)).toEqual(["/ipo/B002", "/ipo/A001", "/ipo/C003"]);
    expect(ranks(container)).toEqual(["2", "1", "3"]);
    await setSort("listing");
    expect(codes(container)).toEqual(["/ipo/B002", "/ipo/A001", "/ipo/C003"]);
    await setSort("absorption");
    expect(codes(container)).toEqual(["/ipo/B002", "/ipo/C003", "/ipo/A001"]);
    expect(ranks(container)).toEqual(["2", "3", "1"]);
    await act(async () => root.unmount());
  });
});

describe("HomeClient のピックアップ（手法の切り替え）", () => {
  const market = { sentiment: "neutral" } as MarketData;
  const bbIpo = ipo("648A");
  const bbPicks = [
    { code: "648A", phase: "open" as const, underwriterStat: null, context: {}, breakEvenProbability: 0.2 },
  ];

  function renderHome(initialMethod: "bb" | "short" | "mid" | "attention" | "holdings" | "yutai") {
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

  it("上部タブの先頭は「ピックアップ」、中の切り替えは BB・短期セカンダリ・中長期セカンダリ・注目度・大量保有・優待の順", () => {
    const container = renderHome("bb");
    const tablists = container.querySelectorAll('[role="tablist"]');
    expect(tablists).toHaveLength(2);
    expect(tablists[0].querySelector('[role="tab"]')?.textContent).toBe("ピックアップ");
    expect([...tablists[1].querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      "BB",
      "短期セカンダリ",
      "中長期セカンダリ",
      "注目度",
      "大量保有",
      "優待",
    ]);
  });

  it.each([
    ["bb", "BB", "BB スコア順"],
    ["short", "短期セカンダリ", "チェックのクリア数順"],
    ["mid", "中長期セカンダリ", "中長期セカンダリ（高値から"],
    ["attention", "注目度", "注目度ランキング"],
    ["holdings", "大量保有", "大量保有報告書"],
    ["yutai", "優待", "権利付最終日"],
  ] as const)("initialMethod=%s で %s を選び、その中身を出す", (method, label, text) => {
    const container = renderHome(method);
    const selected = container.querySelectorAll('[role="tablist"]')[1].querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toBe(label);
    expect(container.textContent).toContain(text);
  });

  it("中長期セカンダリには注目度ランキングを出さない（別の手法「注目度」に分けた）", () => {
    expect(renderHome("mid").textContent).not.toContain("注目度ランキング");
  });

  it("上部タブはピックアップ・売買カレンダー・分析の 3 つで、右端に /events への「予定 →」がある", () => {
    const container = renderHome("bb");
    const tabs = [...container.querySelectorAll('[role="tablist"]')[0].querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["ピックアップ", "売買カレンダー", "分析"]);
    const link = [...container.querySelectorAll('a[href="/events"]')].find((a) => a.textContent?.includes("予定"));
    expect(link).toBeDefined();
  });

  it("分析タブは以前の概要（今週の BB・スコア上位）と実績（初値騰落率）を縦に並べる", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <HomeClient
        ipos={[bbIpo]}
        market={
          {
            sentiment: "neutral",
            indicators: { nikkeiTrend: "flat", growth250Trend: "flat" },
            updatedAt: "2026-09-30T00:00:00Z",
          } as MarketData
        }
        todayIso="2026-09-30"
        initialTab="analytics"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("今週の BB");
    expect(text).toContain("スコア上位");
    expect(text).toContain("初値騰落率 上位");
    expect(text).toContain("初値騰落率 下位");
  });
});
