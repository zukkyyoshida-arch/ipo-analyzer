import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HotFile } from "@/lib/hot/file";
import type { HotItem } from "@/lib/hot/score";
import { HotRankingPanel } from "./HotRankingPanel";

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
