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
  return {
    month: 12,
    prevMonth: 11,
    listUrl: "",
    listedCount: 3,
    items,
    asOf: "2026-10-01",
    generatedAt: "",
    baseline: {
      n: 3,
      winRate10: 0.55,
      avgRet10: 0.006,
      avgHighRet10: 0.05,
      years: Array.from({ length: 10 }, (_, i) => ({
        year: 2016 + i,
        n: 3,
        winRate: i === 0 ? 0.667 : 0.5,
        avgRet: i === 1 ? -0.012 : 0.01,
        avgHighRet: 0.05,
      })),
    },
    ...over,
  };
}

function month3(): YutaiMonthFile {
  return { month: 3, prevMonth: 2, listUrl: "", listedCount: 1, items: [item("4444")], asOf: "2026-10-01", generatedAt: "", baseline: null };
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
  window.localStorage.removeItem("yutai.splitCount");
  window.localStorage.removeItem("yutai.sortKey");
});

const rowsOf = (c: HTMLElement) => [...c.querySelectorAll("section > ol > li")] as HTMLElement[];

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

  it("順位付きの行（リンク・枡・数字の帯・総合点）と、地合いの帯", async () => {
    stubFetch();
    const { container: c, unmount } = await mount(panel());
    expect(c.textContent).toContain("12月権利 → 11月の月足を見る");
    expect(c.textContent).toContain("対象 3 社");
    expect(c.textContent).toContain("10/1 取得");
    expect(c.textContent).toContain("買いは 11月初 → 売りは 12月の権利付最終日まで");
    // 地合い
    const band = c.querySelector('[aria-label="月の地合い"]')!;
    expect(band.textContent).toContain("12月権利の前月（11月）の地合い");
    expect(band.textContent).toContain("全 3 社・10年平均で勝率 55%・前月平均 +0.6%・最大上昇 +5%");
    expect(band.querySelectorAll("li")).toHaveLength(10);
    expect(band.querySelector("li")!.textContent).toBe("201667%+1%");
    // 1 位の行
    const rows = rowsOf(c);
    expect(rows).toHaveLength(3);
    const top = rows[0];
    expect(top.querySelector('[aria-label="順位 1"]')).not.toBeNull();
    expect(top.textContent).toContain("銘柄1111");
    expect(top.querySelector('[aria-label="総合"]')!.textContent).toBe("63"); // 2222 と比べて 10 年勝率だけ上
    expect(top.textContent).toContain("10年 80%");
    expect(top.textContent).toContain("+1.2%");
    expect(top.textContent).toContain("地合い比 +0.6pt");
    expect(top.textContent).toContain("+6.8%");
    expect(top.textContent).toContain("31.5万円");
    expect(top.textContent).not.toContain("3.17%"); // 利回りは扱わない
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
    // データ不足は最後で総合点なし。強/良の折りたたみは無い
    expect(rows[2].textContent).toContain("銘柄3333");
    expect(rows[2].textContent).toContain("データ不足");
    expect(rows[2].querySelector('[aria-label="総合"]')!.textContent).toBe("—");
    expect(c.textContent).not.toContain("ほかの");
    // 資金を指定していなければ推奨買付は出さない
    expect(c.textContent).not.toContain("予算内");
    expect(c.textContent).toContain("先回り買いとは");
    expect(c.textContent).toContain("+8% まで上がったら +5% に逆指値");
    expect(c.textContent).toContain("大和IR 株主優待ガイド");
    unmount();
  });

  it("詳細を開くと利確・逆指値の目安と前年の値幅が出る", async () => {
    stubFetch();
    const { container: c, unmount } = await mount(panel());
    const top = rowsOf(c)[0];
    expect(top.textContent).not.toContain("逆指値");
    const btn = top.querySelector("button[aria-expanded]") as HTMLButtonElement;
    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(top.textContent).toContain("利確目安 ¥1,100（+10%）・¥1,080（+8%）に達したら ¥1,050（+5%）に逆指値");
    expect(top.textContent).toContain("前年 安値→高値: +13.8%（2025年の月足");
    unmount();
  });

  it("並び順を変えると指標の順になる（以前の値は総合に戻す）", async () => {
    const m = month12();
    m.items = [item("1111", { avgHighRet10: 0.01 }), item("2222", { up10: 3, n10: 10, avgHighRet10: 0.2 })];
    stubFetch({ 12: m });
    window.localStorage.setItem("yutai.sortKey", JSON.stringify("wins"));
    const { container: c, unmount } = await mount(panel());
    expect(rowsOf(c)[0].textContent).toContain("銘柄1111");
    const sel = [...c.querySelectorAll("select")].find((s) => s.value === "score") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      "総合",
      "10年の勝率",
      "直近5年の勝利数",
      "前月平均",
      "最大上昇の平均",
      "最低投資額",
    ]);
    await act(async () => {
      sel.value = "highRet";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowsOf(c)[0].textContent).toContain("銘柄2222");
    unmount();
  });

  it("古い一覧には注意が出る", async () => {
    stubFetch({ 12: month12({ asOf: "2026-07-01" }) });
    const { container, unmount } = await mount(panel());
    expect(container.textContent).toContain("一覧が古い（7/1 取得）");
    unmount();
  });

  it("資金で絞り、投資額不明の銘柄は残し、推奨買付と利確目安を出す。枠超えは最後に薄く", async () => {
    const m = month12();
    m.items.push(
      item("5555", { minInvest: null }),
      item("6666", { minInvest: 900_000 }),
      item("7777", { up10: 10, n10: 10, up5: 5, avgRet10: 0.05, avgHighRet10: 0.1, price: 3_000, minInvest: 300_000 }),
    );
    stubFetch({ 12: m });
    window.localStorage.setItem("yutai.budgetMan", JSON.stringify("50"));
    const { container: c, unmount } = await mount(panel());
    expect(c.textContent).toContain("予算内 4社（最低投資額が不明 1社） · 1銘柄の枠 10万円");
    expect(c.textContent).not.toContain("銘柄6666");
    expect(c.textContent).toContain("銘柄5555");
    expect(c.textContent).toContain("投資額不明");
    const rows = rowsOf(c);
    // 7777 は総合 1 位だが 100 株 30 万円が枠 10 万円を超えるので最後
    expect(rows[0].textContent).toContain("銘柄1111");
    expect(rows[0].textContent).toContain("100株");
    expect(rows[0].textContent).toContain("¥100,000");
    expect(rows[0].textContent).toContain("¥1,100");
    const last = rows[rows.length - 1];
    expect(last.textContent).toContain("銘柄7777");
    expect(last.textContent).toContain("枠超え");
    expect(last.className).toContain("opacity-50");
    unmount();
  });

  it("以前の自由入力の資金は一番近い選択肢に丸め、分散数 4 で枠が変わる", async () => {
    stubFetch();
    window.localStorage.setItem("yutai.budgetMan", JSON.stringify("70"));
    window.localStorage.setItem("yutai.splitCount", JSON.stringify("4"));
    const { container: c, unmount } = await mount(panel());
    const selects = [...c.querySelectorAll("select")] as HTMLSelectElement[];
    expect(selects[0].value).toBe("50");
    expect([...selects[0].options].map((o) => o.textContent)).toEqual([
      "指定なし",
      "10万円",
      "20万円",
      "30万円",
      "50万円",
      "100万円",
      "150万円",
      "200万円",
      "300万円",
      "500万円",
    ]);
    expect(selects[1].value).toBe("4");
    expect(c.textContent).toContain("1銘柄の枠 12.5万円");
    expect(rowsOf(c)[0].textContent).toContain("100株");
    unmount();
  });

  it("最初は 50 社、「さらに 50 社を見る」で増える", async () => {
    const m = month12();
    m.items = Array.from({ length: 60 }, (_, i) => item(String(1000 + i), { up10: i % 10 }));
    stubFetch({ 12: m });
    const { container: c, unmount } = await mount(panel());
    expect(rowsOf(c)).toHaveLength(50);
    const more = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("さらに")) as HTMLButtonElement;
    expect(more.textContent).toBe("さらに 10 社を見る（残り 10 社）");
    act(() => more.click());
    expect(rowsOf(c)).toHaveLength(60);
    expect(c.textContent).not.toContain("さらに");
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
