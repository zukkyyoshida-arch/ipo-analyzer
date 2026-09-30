import { describe, expect, it } from "vitest";
import {
  ceilTick,
  floorTick,
  limitWidth,
  lineAbove,
  lineBelow,
  preOpenUpperLimit,
  stopHigh,
  stopLow,
  tickSize,
} from "./priceLimits";

describe("limitWidth", () => {
  it("表の境界（未満）で値幅が変わる", () => {
    expect(limitWidth(99)).toBe(30);
    expect(limitWidth(100)).toBe(50);
    expect(limitWidth(999)).toBe(150);
    expect(limitWidth(1000)).toBe(300);
    expect(limitWidth(2001)).toBe(500);
    expect(limitWidth(2999)).toBe(500);
    expect(limitWidth(3000)).toBe(700);
    expect(limitWidth(999_999)).toBe(150_000);
  });
});

describe("tickSize", () => {
  it("3000円以下は1円、5000円以下は5円、30000円以下は10円", () => {
    expect(tickSize(3000)).toBe(1);
    expect(tickSize(3001)).toBe(5);
    expect(tickSize(5000)).toBe(5);
    expect(tickSize(5001)).toBe(10);
    expect(tickSize(30_001)).toBe(50);
  });
});

describe("stopHigh / stopLow", () => {
  it("初値2001円 → 値幅500円 → ストップ高2501円", () => {
    expect(limitWidth(2001)).toBe(500);
    expect(stopHigh(2001)).toBe(2501);
  });
  it("基準2501円 → 3001円を5円刻みに切り上げて3005円", () => {
    expect(stopHigh(2501)).toBe(3005);
  });
  it("基準4495円 → 5195円を5円刻みに切り上げて5200円（価格データで確認した挙動）", () => {
    expect(stopHigh(4495)).toBe(5200);
  });
  it("ストップ安は基準 − 値幅", () => {
    expect(stopLow(2001)).toBe(1501);
    expect(stopLow(1000)).toBe(700);
  });
});

describe("lineAbove / lineBelow", () => {
  it("初値 + 値幅×X% を呼値に切り上げ", () => {
    expect(lineAbove(2001, 50)).toBe(2251);
    expect(lineAbove(2001, 100)).toBe(2501);
    expect(lineAbove(2001, 200)).toBe(3005); // 3001 → 5円刻み
    expect(lineAbove(1000, 25)).toBe(1075);
  });
  it("初値 −Y% を呼値に切り下げ", () => {
    expect(lineBelow(2001, 10)).toBe(1800); // 1800.9 → 1800
    expect(lineBelow(4000, 10)).toBe(3600);
    expect(lineBelow(3500, 3)).toBe(3395);
  });
  it("浮動小数の誤差で1刻みずれない", () => {
    expect(ceilTick(3005.0000000001)).toBe(3005);
    expect(floorTick(2999.9999999999)).toBe(3000);
  });
});

describe("preOpenUpperLimit", () => {
  it("公開価格の2.3倍", () => {
    expect(preOpenUpperLimit(1000)).toBe(2300);
    expect(preOpenUpperLimit(1530)).toBe(3515); // 3519 → 5円刻みに切り下げ
  });
});
