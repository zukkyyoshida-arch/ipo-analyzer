import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_TAB, HOME_TABS, parseHomeTab } from "./tabs";

describe("ホームのタブ", () => {
  it("先頭は注目度で、既定のタブ", () => {
    expect(HOME_TABS[0]).toEqual({ value: "hot", label: "注目度" });
    expect(DEFAULT_HOME_TAB).toBe("hot");
    expect(HOME_TABS.map((t) => t.label)).toEqual(["注目度", "概要", "今後の予定", "実績"]);
  });

  it("?tab= の値でタブを開く", () => {
    expect(parseHomeTab("hot")).toBe("hot");
    expect(parseHomeTab("overview")).toBe("overview");
    expect(parseHomeTab("upcoming")).toBe("upcoming");
    expect(parseHomeTab("results")).toBe("results");
  });

  it("未指定・不明な値・複数指定は既定のタブ", () => {
    expect(parseHomeTab(undefined)).toBe("hot");
    expect(parseHomeTab("")).toBe("hot");
    expect(parseHomeTab("toString")).toBe("hot");
    expect(parseHomeTab(["overview", "results"])).toBe("hot");
  });
});
