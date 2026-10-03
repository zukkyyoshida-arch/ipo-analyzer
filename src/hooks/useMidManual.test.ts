import { describe, expect, it } from "vitest";
import { normalizeMidManual } from "./useMidManual";

describe("normalizeMidManual", () => {
  it("正しい判定だけを残し、壊れた値は捨てる", () => {
    expect(normalizeMidManual({ "130A": "strong", "137A": "ok", "138A": "ng", "142A": "x", "143A": 1 })).toEqual({
      "130A": "strong",
      "137A": "ok",
      "138A": "ng",
    });
    expect(normalizeMidManual(null)).toEqual({});
    expect(normalizeMidManual(["strong"])).toEqual({});
    expect(normalizeMidManual("strong")).toEqual({});
  });
});
