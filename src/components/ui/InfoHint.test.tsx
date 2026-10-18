import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { InfoHint } from "./InfoHint";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("InfoHint", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("押すまで本文は出ず、押すとシートが開いて本文が見える", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<InfoHint title="注意">判断材料であり売買推奨ではありません。</InfoHint>));
    expect(document.body.textContent).not.toContain("売買推奨");
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="説明を見る"]');
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("判断材料であり売買推奨ではありません。");
  });

  it("label を渡すと aria-label が変わる", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<InfoHint label="免責を見る">x</InfoHint>));
    expect(container.querySelector('button[aria-label="免責を見る"]')).not.toBeNull();
  });
});
