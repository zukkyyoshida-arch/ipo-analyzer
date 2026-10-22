import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HOLDINGS_ATTRIBUTION, HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "@/lib/holdings/types";
import { pickHoldingsMethod } from "@/lib/picks/holdings";
import { HoldingsPanel } from "./HoldingsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(f: HoldingsFile): HTMLElement {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<HoldingsPanel result={pickHoldingsMethod(f, TODAY, "month")} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

function chip(c: HTMLElement, label: string): HTMLButtonElement {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`chip not found: ${label}`);
  return b as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function codes(c: HTMLElement): string[] {
  return [...c.querySelectorAll("ol > li a")].map((a) => a.getAttribute("href")!.replace("/ipo/", ""));
}

function ranks(c: HTMLElement): string[] {
  return [...c.querySelectorAll("ol > li")].map((li) => /(\d+)位/.exec(li.textContent ?? "")?.[1] ?? "");
}

const items = [
  item({ code: "646A", name: "増加銘柄" }),
  item({ code: "640A", name: "減少銘柄", docId: "X", delta: -0.02 }),
  item({ code: "111A", name: "昨週", docId: "Y", submitDate: "2026-09-26", ratio: 0.2, delta: 0.01, purpose: "政策投資" }),
  item({
    code: "222A", name: "新規月", docId: "Z", submitDate: "2026-09-10", formType: "new",
    ratio: 0.12, prevRatio: null, delta: null,
  }),
];

describe("HoldingsPanel", () => {
  it("直近30日を順位付きで並べ、行は銘柄詳細へ。減少は出さない・出典を出す", () => {
    const c = mount(file(items));
    const rows = [...c.querySelectorAll("ol > li")];
    expect(codes(c)).toEqual(["646A", "111A", "222A"]);
    expect(ranks(c)).toEqual(["1", "2", "3"]);
    expect(rows[0].textContent).toContain("テスト投資顧問");
    expect(rows[0].textContent).toContain("5.0% → 7.1%");
    expect(rows[0].textContent).toContain("+2.11pt");
    expect(rows[0].textContent).toContain("買い増し");
    expect(rows[0].textContent).toContain("目的：純投資");
    expect(c.textContent).not.toContain("減少銘柄");
    expect(c.textContent).toContain("全 3銘柄 → 表示 3銘柄");
    expect(c.querySelector('button[aria-label="説明を見る"]')).not.toBeNull();
    expect(c.textContent).toContain(HOLDINGS_ATTRIBUTION.processedNote);
    expect(c.querySelector(`a[href="${HOLDINGS_ATTRIBUTION.licenseUrl}"]`)).not.toBeNull();
  });

  it("「今日」チップで絞ると以前の today と同じ集合。順位は固定", () => {
    const c = mount(file(items));
    click(chip(c, "今日"));
    expect(codes(c)).toEqual(pickHoldingsMethod(file(items), TODAY, "today").picks.map((p) => p.code));
    click(chip(c, "今日")); // 解除
    click(chip(c, "新規"));
    expect(codes(c)).toEqual(["222A"]);
    expect(ranks(c)).toEqual(["3"]);
  });

  it("並び替えをしても順位の数字は固定。0 件なら案内を出す", () => {
    const c = mount(file(items));
    const select = c.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "ratio";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(codes(c)).toEqual(["111A", "222A", "646A"]);
    expect(ranks(c)).toEqual(["2", "3", "1"]);
    click(chip(c, "重要提案あり"));
    expect(c.textContent).toContain("条件に当てはまる銘柄はありません");
    expect(c.querySelectorAll("ol > li")).toHaveLength(0);
  });

  it("30 件ずつ見せ、さらに見るで増やす", () => {
    const many = Array.from({ length: 35 }, (_, i) => item({ code: String(1000 + i), docId: `M${i}` }));
    const c = mount(file(many));
    expect(c.querySelectorAll("ol > li")).toHaveLength(30);
    const more = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("さらに"));
    expect(more).toBeTruthy();
    click(more as HTMLElement);
    expect(c.querySelectorAll("ol > li")).toHaveLength(35);
  });
});
