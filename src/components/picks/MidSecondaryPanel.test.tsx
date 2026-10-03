import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

describe("MidSecondaryPanel", () => {
  const file: MidFile = { asOf: "2026-09-29", generatedAt: "", universe: 40, items: [item("111A", -0.65), item("222A", -0.45)] };
  const picks = rankMidSecondary([makeIpo({ code: "111A", listingDate: "2025-12-01" })], file, {}, TODAY);

  it("候補を行に出し、段階だけの銘柄は折りたたみへ。行は銘柄詳細へ、注記に検証の数字", () => {
    const c = render(renderToStaticMarkup(<MidSecondaryPanel picks={picks} file={file} todayIso={TODAY} />));
    expect(c.textContent).toContain("中長期セカンダリ");
    const top = c.querySelector("section > ol > li")!;
    expect(top.querySelector("a")?.getAttribute("href")).toBe("/ipo/111A");
    expect(top.textContent).toContain("−65%");
    expect(top.textContent).toContain("−60% 初到達 9/20");
    expect(top.querySelectorAll('[role="listitem"]')).toHaveLength(13);
    expect(top.textContent).toContain("クリア ");
    expect(top.querySelector("details")?.textContent).toContain("①");
    expect(top.querySelectorAll('button[aria-pressed]')).toHaveLength(3);
    expect(c.querySelector("section > details")?.textContent).toContain("銘柄222A");
    expect(c.textContent).toContain("過去検証で効果なし");
    expect(c.textContent).toContain("+7.7%");
    expect(c.textContent).toContain("+2.6〜+13.2%");
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
