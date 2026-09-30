import { describe, expect, it } from "vitest";
import { PICK_METHODS, PICK_METHOD_PARAM, defaultPickMethod, parsePickMethod } from "./picks";

describe("ピックアップの手法", () => {
  it("BB・セカンダリー・大量保有・優待の順", () => {
    expect(PICK_METHODS.map((m) => m.label)).toEqual(["BB", "セカンダリー", "大量保有", "優待"]);
    expect(PICK_METHODS.map((m) => m.value)).toEqual(["bb", "secondary", "holdings", "yutai"]);
    expect(PICK_METHOD_PARAM).toBe("m");
  });

  it("?m= が無いときは、BB 受付中の銘柄があれば BB、無ければセカンダリー", () => {
    expect(defaultPickMethod(1)).toBe("bb");
    expect(defaultPickMethod(3)).toBe("bb");
    expect(defaultPickMethod(0)).toBe("secondary");
  });

  it("?m= の値で手法を開く（既定より優先）", () => {
    expect(parsePickMethod("bb", "secondary")).toBe("bb");
    expect(parsePickMethod("secondary", "bb")).toBe("secondary");
    expect(parsePickMethod("holdings", "bb")).toBe("holdings");
    expect(parsePickMethod("yutai", "secondary")).toBe("yutai");
  });

  it("未指定・不明な値・複数指定は既定の手法", () => {
    expect(parsePickMethod(undefined, "bb")).toBe("bb");
    expect(parsePickMethod(undefined, "secondary")).toBe("secondary");
    expect(parsePickMethod("", "secondary")).toBe("secondary");
    expect(parsePickMethod("hot", "secondary")).toBe("secondary");
    expect(parsePickMethod("toString", "bb")).toBe("bb");
    expect(parsePickMethod(["bb", "yutai"], "secondary")).toBe("secondary");
  });
});
