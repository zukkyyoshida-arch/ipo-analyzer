import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { YutaiItem, YutaiMonthFile } from "@/lib/yutai/types";
import { YutaiPanel } from "./YutaiPanel";

function item(code: string, o: Partial<YutaiItem> = {}): YutaiItem {
  return {
    code,
    name: `銘柄${code}`,
    minInvest: 315_000,
    yutaiYield: 3.17,
    divYield: 1,
    totalYield: 4,
    rightsMonths: [12],
    detailUrl: `https://example.com/${code}`,
    candles: Array.from({ length: 10 }, (_, i) => ({ year: 2016 + i, open: 100, close: i < 8 ? 103.2 : 95, high: 107, low: 94 })),
    up10: 8,
    n10: 10,
    up5: 4,
    n5: 5,
    avgRet10: 0.012,
    avgHighRet10: 0.068,
    price: 1000,
    high12: 1050,
    low12: 800,
    ...o,
  };
}

const TODAY = "2026-10-01";

function month12(over: Partial<YutaiMonthFile> = {}): YutaiMonthFile {
  const items = [item("1111"), item("2222", { up10: 3, n10: 10 }), item("3333", { up10: 3, n10: 3, candles: [] })];
  return { month: 12, prevMonth: 11, listUrl: "", listedCount: 3, items, asOf: "2026-10-01", generatedAt: "", ...over };
}

function month3(): YutaiMonthFile {
  return { month: 3, prevMonth: 2, listUrl: "", listedCount: 1, items: [item("4444")], asOf: "2026-10-01", generatedAt: "" };
}

/** 月別の静的ファイルの代わり。既定は 3・12 月だけあり、9 月は 500、ほかは 404。 */
function stubFetch(files: Record<number, YutaiMonthFile> = { 12: month12(), 3: month3() }) {
  const fn = vi.fn(async (url: string) => {
    const m = Number(/\/(\d+)\.json$/.exec(url)?.[1]);
    if (m === 9) return new Response("", { status: 500 });
    const f = files[m];
    return f ? new Response(JSON.stringify(f), { status: 200 }) : new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 実際にマウントして、最初の取得が終わるまで待つ。 */
async function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, unmount: () => act(() => root.unmount()) };
}

function clickTab(c: HTMLElement, name: string) {
  const tab = [...c.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLElement;
  act(() => tab.click());
}

const panel = () => <YutaiPanel initialMonth={12} todayIso={TODAY} />;

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.removeItem("yutai.budgetMan");
});

describe("YutaiPanel", () => {
  it("取得中は読み込み中、ファイルが無い（404）ときは更新待ち", async () => {
    stubFetch({});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(panel()));
    expect(container.textContent).toContain("読み込み中…");
    await act(async () => {});
    expect(container.textContent).toContain("更新待ち");
    act(() => root.unmount());
  });

  it("strong の行（リンク・枡・数字の帯）と、other の折りたたみ", async () => {
    stubFetch();
    const { container: c, unmount } = await mount(panel());
    expect(c.textContent).toContain("12月権利 → 11月の月足を見る");
    expect(c.textContent).toContain("対象 3 社");
    expect(c.textContent).toContain("10/1 取得");
    expect(c.textContent).toContain("買いは 11月初 → 売りは 12月の権利付最終日まで");
    const top = c.querySelector("section > ol > li")!;
    expect(top.textContent).toContain("銘柄1111");
    expect(top.textContent).toContain("8/10 80%");
    expect(top.textContent).toContain("4/5");
    expect(top.textContent).toContain("+1.2%");
    expect(top.textContent).toContain("+6.8%");
    expect(top.textContent).toContain("31.5万円");
    expect(top.textContent).not.toContain("3.17%"); // 優待利回りは使わない指標なので出さない
    expect(top.querySelectorAll('[aria-label="過去10年の前月の月足"] > span')).toHaveLength(10);
    expect(top.querySelectorAll(".bg-up.rounded-sm")).toHaveLength(8);
    expect(top.querySelector('[title="2016年 +3.2%"]')).not.toBeNull();
    const links = [...top.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://finance.yahoo.co.jp/quote/1111.T",
      "https://example.com/1111",
      "https://kabutan.jp/stock/finance?code=1111",
    ]);
    expect(links.every((a) => a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    const details = c.querySelector("section > details")!;
    expect(details.textContent).toContain("ほかの 2 社を見る");
    expect(details.textContent).toContain("銘柄3333");
    expect(c.textContent).toContain("先回り買いとは");
    expect(c.textContent).toContain("+8% まで上がったら +5% に逆指値");
    expect(c.textContent).toContain("大和IR 株主優待ガイド");
    unmount();
  });

  it("古い一覧には注意が出る", async () => {
    stubFetch({ 12: month12({ asOf: "2026-07-01" }) });
    const { container, unmount } = await mount(panel());
    expect(container.textContent).toContain("一覧が古い（7/1 取得）");
    unmount();
  });

  it("予算で絞り、投資額不明の銘柄は残す", async () => {
    const m = month12();
    m.items.push(item("5555", { minInvest: null }), item("6666", { minInvest: 900_000 }));
    stubFetch({ 12: m });
    window.localStorage.setItem("yutai.budgetMan", JSON.stringify("50"));
    const { container, unmount } = await mount(panel());
    expect(container.textContent).toContain("予算 50万円以内 4社");
    expect(container.textContent).not.toContain("銘柄6666");
    expect(container.textContent).toContain("銘柄5555");
    expect(container.textContent).toContain("投資額不明");
    unmount();
  });

  it("月を切り替えると取りに行き、件数が変わる（取得済みの月は再取得しない）", async () => {
    const fetchFn = stubFetch();
    const { container, unmount } = await mount(panel());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/data/yutai/12.json");
    expect(container.textContent).toContain("対象 3 社");
    await act(async () => clickTab(container, "3月"));
    expect(container.textContent).toContain("対象 1 社");
    expect(container.textContent).toContain("銘柄4444");
    await act(async () => clickTab(container, "12月"));
    expect(container.textContent).toContain("対象 3 社");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await act(async () => clickTab(container, "5月"));
    expect(container.textContent).toContain("更新待ち");
    unmount();
  });

  it("取得に失敗したときも更新待ち", async () => {
    stubFetch();
    const { container, unmount } = await mount(panel());
    await act(async () => clickTab(container, "9月"));
    expect(container.textContent).toContain("更新待ち");
    unmount();
  });
});
