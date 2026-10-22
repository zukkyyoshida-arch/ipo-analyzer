import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { HotFile } from "@/lib/hot/file";
import type { HotItem } from "@/lib/hot/score";
import { HotRankingPanel } from "./HotRankingPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(code: string, overrides: Partial<HotItem> = {}): HotItem {
  return {
    code,
    name: `銘柄${code}`,
    listingDate: "2026-09-01",
    score: 80,
    r5: 0.4,
    r20: 0.4,
    volRatio: null,
    highProx: 1,
    turnover5: 1e9,
    initialRatio: 1.2,
    reasons: [],
    ...overrides,
  };
}

/** 行（li）を描いて、指標の帯の見出しと値を取り出す。 */
function rowOf(it: HotItem) {
  const hot: HotFile = { asOf: "2026-09-29", generatedAt: "x", universe: 1, items: [it] };
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<HotRankingPanel hot={hot} todayIso="2026-09-30" />);
  const li = container.querySelector("ol > li")!;
  // 指標の帯は 5 列（5日・20日・出来高・高値比・売買代金）
  const cells = [...li.querySelectorAll("span.grid > span")];
  return {
    // スマホの見出し（lg:hidden）
    labels: cells.map((c) => c.querySelector(".lg\\:hidden")?.textContent),
    // 1280px で値の後ろに添える印（hidden lg:inline）
    marks: cells.map((c) => c.querySelector(".lg\\:inline")?.textContent ?? null),
    // 値そのもの
    values: cells.map((c) => c.lastElementChild?.firstChild?.textContent),
    text: li.textContent ?? "",
  };
}

describe("HotRankingPanel の指標の帯（上場来の印）", () => {
  it("n=3: 5日・20日とも基準が上場初日の始値なので、どちらにも「上場来」を付ける", () => {
    const row = rowOf(item("A", { bars: 3, reasons: ["上場来 +40%", "上場来高値圏"] }));
    expect(row.labels).toEqual(["上場来", "上場来", "出来高", "高値比", "売買代金"]);
    expect(row.marks).toEqual(["上場来", "上場来", null, null, null]);
    expect(row.values.slice(0, 2)).toEqual(["+40.0%", "+40.0%"]);
  });

  it("n=10: 20日だけ「上場来」", () => {
    const row = rowOf(item("B", { bars: 10, r5: 0.2, r20: 0.45 }));
    expect(row.labels.slice(0, 2)).toEqual(["5日", "上場来"]);
    expect(row.marks.slice(0, 2)).toEqual([null, "上場来"]);
  });

  it("n=30: 従来どおり（印なし）", () => {
    const row = rowOf(item("C", { bars: 30, r5: 0.2, r20: 0.45 }));
    expect(row.labels.slice(0, 2)).toEqual(["5日", "20日"]);
    expect(row.marks).toEqual([null, null, null, null, null]);
  });

  it("bars の無い古いデータは今までの表示（印なし）", () => {
    const row = rowOf(item("D"));
    expect(row.labels.slice(0, 2)).toEqual(["5日", "20日"]);
    expect(row.marks).toEqual([null, null, null, null, null]);
  });
});

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function mount(items: HotItem[], universe = items.length) {
  const hot: HotFile = { asOf: "2026-09-29", generatedAt: "x", universe, items };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<HotRankingPanel hot={hot} todayIso="2026-09-30" />));
  const ranks = () => [...container.querySelectorAll("ol > li")].map((li) => li.textContent ?? "");
  const chip = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent === label)!;
  return { container, ranks, chip };
}

describe("HotRankingPanel の全件ランキング・絞り込み", () => {
  const sample = [
    item("1001", { score: 90, r5: 0.3, r20: 0.5, volRatio: 3 }),
    item("1002", { score: 60, r5: 0.05, r20: 0.1, volRatio: 1, highProx: 0.9 }),
    item("1003", { score: 75, r5: 0.12, r20: 0.25, volRatio: 2.5 }),
  ];

  it("全件を順位つきで出し、件数の行を出す", async () => {
    const { container, ranks } = await mount(sample);
    expect(ranks()).toHaveLength(3);
    expect(container.textContent).toContain("全 3銘柄 → 表示 3銘柄");
  });

  it("チップで絞っても順位の数字は元のまま", async () => {
    const { container, ranks, chip } = await mount(sample);
    act(() => chip("出来高2倍以上").click());
    expect(ranks()).toHaveLength(2);
    expect(ranks()[1]).toContain("1003");
    expect(ranks()[1].startsWith("3")).toBe(true);
    expect(container.textContent).toContain("表示 2銘柄");
    act(() => chip("注目度70以上").click());
    expect(ranks()).toHaveLength(2);
    act(() => chip("5日 +10%以上").click());
    expect(ranks()).toHaveLength(2);
    act(() => chip("上場来高値圏").click());
    expect(ranks()).toHaveLength(2);
  });

  it("並び替えても順位の数字は固定", async () => {
    const { container, ranks } = await mount(sample);
    const sel = container.querySelector("select")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(sel, "r20");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const r = ranks();
    expect(r[0]).toContain("1001");
    expect(r[1]).toContain("1003");
    expect(r[1].startsWith("3")).toBe(true);
    expect(r[2].startsWith("2")).toBe(true);
  });

  it("30件を超えると「さらに見る」が出て押すと増える", async () => {
    const many = Array.from({ length: 45 }, (_, i) => item(String(2000 + i)));
    const { container, ranks } = await mount(many);
    expect(ranks()).toHaveLength(30);
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("さらに"))!;
    expect(btn.textContent).toContain("残り 15 件");
    act(() => btn.click());
    expect(ranks()).toHaveLength(45);
  });

  it("ファイルの件数が母集団より少ないときは注記する", async () => {
    const { container } = await mount(sample, 44);
    expect(container.textContent).toContain("全 44銘柄 → 表示 3銘柄（ファイルには上位 3 件）");
  });
});
