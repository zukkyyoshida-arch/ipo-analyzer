import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DISCLAIMER_ACCEPTED_KEY, FirstRunDisclaimer } from "./FirstRunDisclaimer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FirstRunDisclaimer />));
  return container;
}

describe("FirstRunDisclaimer", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("未同意なら出て、同意ボタンで ISO 日時を保存して閉じる", () => {
    mount();
    expect(document.body.textContent).toContain("同意して使いはじめる");
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "同意して使いはじめる")!;
    act(() => btn.click());
    const saved = JSON.parse(window.localStorage.getItem(DISCLAIMER_ACCEPTED_KEY) ?? "null");
    expect(Number.isNaN(Date.parse(saved))).toBe(false);
    expect(document.body.textContent).not.toContain("同意して使いはじめる");
  });

  it("保存済みなら出ない", () => {
    window.localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, JSON.stringify("2026-10-19T00:00:00.000Z"));
    mount();
    expect(document.body.textContent).not.toContain("同意して使いはじめる");
  });
});
