import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_THRESHOLDS as T } from "@/lib/checkpoints/thresholds";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import { rankShortSecondary } from "@/lib/picks/shortSecondary";
import { ShortSecondaryPanel } from "./ShortSecondaryPanel";

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
});
