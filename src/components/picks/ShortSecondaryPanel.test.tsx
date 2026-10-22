import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_THRESHOLDS as T } from "@/lib/checkpoints/thresholds";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import { rankShortSecondary } from "@/lib/picks/shortSecondary";
import { ShortSecondaryPanel } from "./ShortSecondaryPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(html: string) {
  const c = document.createElement("div");
  c.innerHTML = html;
  return c;
}

describe("ShortSecondaryPanel", () => {
  it("段階・判定・入る上限・利確損切り・株数を出し、行は銘柄詳細へ", () => {
    const picks = rankShortSecondary(
      [
        makeIpo({ code: "646A", name: "上場後", listingDate: "2026-09-29", initialPrice: 1500, currentPrice: 1100, initialVolume: 1000 }),
        makeIpo({ code: "640A", name: "上場前", listingDate: "2026-10-01" }),
      ],
      [
        { code: "646A", forecast: { center: 1300, low80: 1000, high80: 1800, ratio: 1.3 } },
        { code: "640A", forecast: { center: 2500, low80: 2000, high80: 3200, ratio: 2.5 } },
      ],
      {},
      T,
      "2026-09-30",
    );
    const c = render(renderToStaticMarkup(<ShortSecondaryPanel picks={picks} thresholds={T} />));
    const rows = [...c.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(2);
    const after = rows.find((r) => r.textContent?.includes("上場後"))!;
    expect(after.querySelector("a")?.getAttribute("href")).toBe("/ipo/646A");
    expect(after.textContent).toContain("上場 2 日目");
    expect(after.textContent).toContain("入る目安内");
    expect(after.textContent).toContain("1,170円");
    expect(after.textContent).toContain("1,350円"); // 損切り: 初値 1500 × 0.9
    expect(after.textContent).toContain("400株"); // 50万円 ÷ 1100円
    const before = rows.find((r) => r.textContent?.includes("上場前"))!;
    expect(before.textContent).toContain("即金規制の可能性");
    expect(c.textContent).not.toContain("準備中");
  });

  it("対象が無いときはその旨", () => {
    const c = render(renderToStaticMarkup(<ShortSecondaryPanel picks={[]} thresholds={T} />));
    expect(c.textContent).toContain("上場 5 日以内の銘柄はありません");
  });

  describe("全件ランキングと絞り込み", () => {
    const mounted: { unmount: () => void; el: HTMLElement }[] = [];
    afterEach(() => {
      for (const m of mounted.splice(0)) {
        act(() => m.unmount());
        m.el.remove();
      }
      window.localStorage.clear();
    });

    function makePicks() {
      return rankShortSecondary(
        [
          makeIpo({ code: "646A", name: "上場後", listingDate: "2026-09-29", offeringPrice: 1000, initialPrice: 1500, currentPrice: 1100, initialVolume: 1000 }),
          makeIpo({ code: "640A", name: "上場前", listingDate: "2026-10-01" }),
        ],
        [
          { code: "646A", forecast: { center: 1300, low80: 1000, high80: 1800, ratio: 1.3 } },
          { code: "640A", forecast: { center: 2500, low80: 2000, high80: 3200, ratio: 2.5 } },
        ],
        {},
        T,
        "2026-09-30",
      );
    }

    function mount() {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      act(() => root.render(<ShortSecondaryPanel picks={makePicks()} thresholds={T} />));
      mounted.push({ unmount: () => root.unmount(), el });
      return el;
    }

    const rankMap = (el: HTMLElement) =>
      Object.fromEntries(
        [...el.querySelectorAll("ol > li")].map((li) => [
          li.querySelector("a")?.getAttribute("href"),
          li.querySelector("a > span")?.textContent,
        ]),
      );

    it("全件が順位付きで出て、件数行が出る", () => {
      const el = mount();
      expect(el.querySelectorAll("ol > li")).toHaveLength(2);
      expect(Object.values(rankMap(el)).sort()).toEqual(["1", "2"]);
      expect(el.textContent).toContain("全 2銘柄 → 表示 2銘柄");
    });

    it("チップで絞ると行は減るが順位の数字は元のまま", () => {
      const el = mount();
      const before = rankMap(el);
      const chip = [...el.querySelectorAll("button")].find((b) => b.textContent === "上場前")!;
      act(() => chip.click());
      const rows = el.querySelectorAll("ol > li");
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("上場前");
      expect(rankMap(el)["/ipo/640A"]).toBe(before["/ipo/640A"]);
      expect(el.textContent).toContain("全 2銘柄 → 表示 1銘柄");
    });

    it("並び替えをしても順位の数字は固定", () => {
      const el = mount();
      const before = rankMap(el);
      const select = el.querySelector("select")!;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
        setter.call(select, "rise");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      // 公開価格からの上昇率: 上場後（+50%）が先頭、上場前（算出不可）が末尾
      const hrefs = [...el.querySelectorAll("ol > li a")].map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(["/ipo/646A", "/ipo/640A"]);
      expect(rankMap(el)).toEqual(before);
    });
  });
});
