import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// 各ページ（Server Component）が「今日」を日本時間で計算して子コンポーネントへ渡していることを確かめる。
// Workers は UTC で動くため、UTC の日付を使うと JST の 0:00〜8:59 が前日扱いになる不具合の回帰テスト。

vi.mock("@/lib/repository", () => ({
  getAllIpos: vi.fn(async () => []),
  getMarketData: vi.fn(async () => ({})),
  getHotData: vi.fn(async () => null),
  getMidtermData: vi.fn(async () => null),
  getHistoricalIpos: vi.fn(async () => []),
  getAllEnriched: vi.fn(async () => []),
  getHoldingsData: vi.fn(async () => null),
}));
vi.mock("@/components/home/HomeClient", () => ({ HomeClient: () => null }));
vi.mock("@/components/events/EventsClient", () => ({ EventsClient: () => null }));
vi.mock("@/components/Disclaimer", () => ({ Disclaimer: () => null }));
vi.mock("@/components/screener/ScreenerClient", () => ({ ScreenerClient: () => null }));

import HomePage from "./page";
import EventsPage from "./events/page";
import ScreenerPage from "./screener/page";

/** 返された要素ツリーから todayIso プロパティを持つ要素の値を探す。 */
function findTodayIso(node: ReactNode): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findTodayIso(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return undefined;
  if (typeof props.todayIso === "string") return props.todayIso;
  return findTodayIso(props.children as ReactNode);
}

const PAGES: Array<[string, () => Promise<ReactNode>]> = [
  ["ホーム", () => HomePage()],
  ["イベント", () => EventsPage()],
  ["スクリーナー", () => ScreenerPage()],
];

describe.each(PAGES)("%sページの「今日」", (_name, render) => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["JST 7:59（UTC 前日 22:59）は当日", "2026-09-29T22:59:00Z", "2026-09-30"],
    ["JST 0:00 の直前は前日", "2026-09-29T14:59:59Z", "2026-09-29"],
    ["JST 0:00 ちょうどで翌日", "2026-09-29T15:00:00Z", "2026-09-30"],
    ["JST 23:59 は当日", "2026-09-30T14:59:59Z", "2026-09-30"],
    ["JST 翌 0:00 で翌日", "2026-09-30T15:00:00Z", "2026-10-01"],
    ["年末の JST 0:00 で翌年", "2026-12-31T15:00:00Z", "2027-01-01"],
  ])("%s", async (_label, now, expected) => {
    vi.setSystemTime(new Date(now));
    expect(findTodayIso(await render())).toBe(expected);
  });
});
