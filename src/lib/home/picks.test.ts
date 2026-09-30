import { describe, expect, it } from "vitest";
import { PICK_METHODS, PICK_METHOD_PARAM, defaultPickMethod, parsePickMethod } from "./picks";

describe("ピックアップの手法", () => {
  it("BB・短期セカンダリ・中長期セカンダリ・大量保有・優待の順", () => {
    expect(PICK_METHODS.map((m) => m.label)).toEqual(["BB", "短期セカンダリ", "中長期セカンダリ", "大量保有", "優待"]);
    expect(PICK_METHODS.map((m) => m.value)).toEqual(["bb", "short", "mid", "holdings", "yutai"]);
    expect(PICK_METHOD_PARAM).toBe("m");
  });

  it("?m= が無いときは、BB 受付中 → 短期の対象あり → 中長期の順", () => {
    expect(defaultPickMethod(1)).toBe("bb");
    expect(defaultPickMethod(3, 2)).toBe("bb");
    expect(defaultPickMethod(0, 2)).toBe("short");
    expect(defaultPickMethod(0)).toBe("mid");
  });

  it("以前の ?m=secondary は中長期セカンダリで開く", () => {
    expect(parsePickMethod("secondary", "bb")).toBe("mid");
    expect(parsePickMethod("short", "bb")).toBe("short");
    expect(parsePickMethod("mid", "bb")).toBe("mid");
  });

  it("?m= の値で手法を開く（既定より優先）", () => {
    expect(parsePickMethod("bb", "mid")).toBe("bb");
    expect(parsePickMethod("holdings", "bb")).toBe("holdings");
    expect(parsePickMethod("yutai", "mid")).toBe("yutai");
  });

  it("未指定・不明な値・複数指定は既定の手法", () => {
    expect(parsePickMethod(undefined, "bb")).toBe("bb");
    expect(parsePickMethod(undefined, "mid")).toBe("mid");
    expect(parsePickMethod("", "mid")).toBe("mid");
    expect(parsePickMethod("hot", "mid")).toBe("mid");
    expect(parsePickMethod("toString", "bb")).toBe("bb");
    expect(parsePickMethod(["bb", "yutai"], "mid")).toBe("mid");
  });
});
