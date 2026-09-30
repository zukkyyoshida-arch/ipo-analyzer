import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HOLDINGS_ATTRIBUTION, HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "@/lib/holdings/types";
import { pickHoldingsMethod } from "@/lib/picks/holdings";
import { HoldingsPanel } from "./HoldingsPanel";

const TODAY = "2026-09-30";

function item(p: Partial<HoldingItem> = {}): HoldingItem {
  return {
    code: "9999",
    name: "テスト",
    docId: "S100TEST",
    submitDate: TODAY,
    filer: "テスト投資顧問",
    formType: "change",
    ratio: 0.0712,
    prevRatio: 0.0501,
    delta: 0.0211,
    purpose: "純投資",
    shares: 1000,
    reason: "",
    obligationDate: "2026-09-25",
    listingDate: "2025-03-01",
    ...p,
  };
}

function file(items: HoldingItem[]): HoldingsFile {
  return { generatedAt: "", coveredFrom: "2026-04-03", coveredThrough: TODAY, source: HOLDINGS_SOURCE_TEXT, items };
}

function render(html: string) {
  const c = document.createElement("div");
  c.innerHTML = html;
  return c;
}

describe("HoldingsPanel", () => {
  it("今日の提出を並べ、行は銘柄詳細へ。根拠・提出者・保有割合・出典を出す", () => {
    const f = file([
      item({ code: "646A", name: "増加銘柄" }),
      item({ code: "640A", name: "減少銘柄", docId: "X", delta: -0.02 }),
    ]);
    const c = render(
      renderToStaticMarkup(
        <HoldingsPanel today={pickHoldingsMethod(f, TODAY, "today")} week={pickHoldingsMethod(f, TODAY, "week")} />,
      ),
    );
    const rows = [...c.querySelectorAll("ol > li")];
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/ipo/646A");
    expect(rows[0].textContent).toContain("テスト投資顧問");
    expect(rows[0].textContent).toContain("5.0% → 7.1%");
    expect(rows[0].textContent).toContain("+2.11pt");
    expect(rows[0].textContent).toContain("純投資");
    expect(c.textContent).not.toContain("減少銘柄");
    expect(c.textContent).toContain("決算進捗");
    expect(c.textContent).toContain(HOLDINGS_ATTRIBUTION.processedNote);
    expect(c.querySelector(`a[href="${HOLDINGS_ATTRIBUTION.licenseUrl}"]`)).not.toBeNull();
  });

  it("今日が 0 件なら直近 1 週間への案内を出す", () => {
    const f = file([item({ submitDate: "2026-09-28" })]);
    const c = render(
      renderToStaticMarkup(
        <HoldingsPanel today={pickHoldingsMethod(f, TODAY, "today")} week={pickHoldingsMethod(f, TODAY, "week")} />,
      ),
    );
    expect(c.textContent).toContain("今日は該当なし");
    expect(c.textContent).toContain("直近 1 週間へ（1 銘柄）");
    expect(c.querySelectorAll("ol > li")).toHaveLength(0);
  });
});
