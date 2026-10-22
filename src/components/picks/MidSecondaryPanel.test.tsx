import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import type { MidFile, MidItem } from "@/lib/midterm/file";
import { rankMidSecondary } from "@/lib/picks/midSecondary";
import { MidSecondaryPanel } from "./MidSecondaryPanel";

function render(html: string) {
  const c = document.createElement("div");
  c.innerHTML = html;
  return c;
}

function item(code: string, drawdown: number): MidItem {
  return {
    code,
    name: `銘柄${code}`,
    listingDate: "2025-12-01",
    bars: 200,
    lastDate: "2026-09-29",
    close: 1000 * (1 + drawdown),
    ath: 1000,
    athDate: "2025-12-05",
    low: 300,
    lowDate: "2026-09-10",
    drawdown,
    rebound: (1000 * (1 + drawdown)) / 300 - 1,
    avgVolume20: 150_000,
    hits: { "40": "2026-03-01", "50": "2026-05-01", "60": drawdown <= -0.6 ? "2026-09-20" : null },
  };
}

const TODAY = "2026-09-30";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MidSecondaryPanel", () => {
  const file: MidFile = {
    asOf: "2026-09-29",
    generatedAt: "",
    universe: 40,
    items: [item("111A", -0.65), item("222A", -0.45), item("333A", -0.7), item("444A", -0.2)],
  };
  const picks = rankMidSecondary([makeIpo({ code: "111A", listingDate: "2025-12-01" })], file, {}, TODAY);

  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* 無視 */
    }
    document.body.innerHTML = "";
  });

  async function mount() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<MidSecondaryPanel picks={picks} file={file} todayIso={TODAY} />));
    return { container, unmount: () => act(() => root.unmount()) };
  }
  const rowsOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("section > ol > li")).map((li) => ({
      rank: li.querySelector("a > span")?.textContent,
      code: li.querySelector("a")?.getAttribute("href")?.replace("/ipo/", ""),
    }));
  const chip = (c: HTMLElement, label: string) =>
    Array.from(c.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((b) => b.textContent?.startsWith(label))!;

  it("全件が 1 本のリストに順位付きで出る。行は銘柄詳細へ、10 項目つき", async () => {
    const { container: c, unmount } = await mount();
    expect(c.textContent).toContain("中長期セカンダリ");
    expect(c.querySelector("section > details")).toBeNull();
    const rows = rowsOf(c);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.rank)).toEqual(["1", "2", "3", "4"]);
    expect(rows.map((r) => r.code)).toEqual(picks.map((p) => p.item.code));
    expect(c.textContent).toContain("全 40銘柄 → 表示 4銘柄");
    const top = c.querySelector("section > ol > li")!;
    expect(top.querySelectorAll('[role="listitem"]')).toHaveLength(13);
    expect(top.querySelector("details")?.textContent).toContain("①");
    expect(top.querySelectorAll("button[aria-pressed]")).toHaveLength(3);
    // 検証の数字・免責は見出しの ⓘ（閉じたシート）に退避している。
    expect(c.querySelector('button[aria-label="説明を見る"]')).not.toBeNull();
    unmount();
  });

  it("「候補」チップで絞ると従来の候補と同じ集合で、順位の数字は元のまま", async () => {
    const { container: c, unmount } = await mount();
    const expected = picks.map((p, i) => ({ code: p.item.code, rank: String(i + 1), cand: p.candidate })).filter((r) => r.cand);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(picks.length);
    await act(async () => chip(c, "候補").click());
    expect(rowsOf(c).map((r) => [r.code, r.rank])).toEqual(expected.map((r) => [r.code, r.rank]));
    expect(c.textContent).toContain(`表示 ${expected.length}銘柄（候補 ${expected.length}）`);
    unmount();
  });

  it("並び替えても順位は固定（下落率の深い順）", async () => {
    const { container: c, unmount } = await mount();
    const rankByCode = new Map(picks.map((p, i) => [p.item.code, String(i + 1)]));
    const select = c.querySelector("select")!;
    await act(async () => {
      select.value = "drawdown";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rows = rowsOf(c);
    expect(rows.map((r) => r.code)).toEqual(["333A", "111A", "222A", "444A"]);
    for (const r of rows) expect(r.rank).toBe(rankByCode.get(r.code!));
    unmount();
  });

  it("ファイルが無い・古いときは更新待ち", () => {
    const c = render(renderToStaticMarkup(<MidSecondaryPanel picks={[]} file={null} todayIso={TODAY} />));
    expect(c.textContent).toContain("更新待ち");
    const old = render(
      renderToStaticMarkup(<MidSecondaryPanel picks={picks} file={{ ...file, asOf: "2026-09-01" }} todayIso={TODAY} />),
    );
    expect(old.textContent).toContain("前回の集計");
  });
});
