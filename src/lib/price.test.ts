import { describe, expect, it } from "vitest";
import {
  currentPriceAtListingScale,
  formatSplitRatio,
  hasSplit,
  roundPrice,
  splitFactor,
  toCurrentScale,
  toListingScale,
} from "./price";

describe("splitFactor", () => {
  it("未設定・不正値は 1（分割なし）", () => {
    expect(splitFactor({})).toBe(1);
    expect(splitFactor({ splitFactor: undefined })).toBe(1);
    expect(splitFactor({ splitFactor: 0 })).toBe(1);
    expect(splitFactor({ splitFactor: -2 })).toBe(1);
    expect(splitFactor({ splitFactor: Number.NaN })).toBe(1);
    expect(hasSplit({})).toBe(false);
  });

  it("設定値をそのまま返す", () => {
    expect(splitFactor({ splitFactor: 6 })).toBe(6);
    expect(hasSplit({ splitFactor: 6 })).toBe(true);
  });
});

describe("toListingScale / toCurrentScale", () => {
  // 350A 相当: 公開価格 4,520円・初値 5,310円、上場後に 1:6 分割、現在値 684円。
  const ipo = { splitFactor: 6, currentPrice: 684 };

  it("現在値を上場時の単位へ（× 係数）", () => {
    expect(toListingScale(684, ipo)).toBe(4104);
    expect(currentPriceAtListingScale(ipo)).toBe(4104);
  });

  it("公開価格・初値を現在の単位へ（÷ 係数）", () => {
    expect(toCurrentScale(5310, ipo)).toBe(885);
    expect(roundPrice(toCurrentScale(4520, ipo))).toBe(753.3);
  });

  it("分割なしは値を変えない", () => {
    expect(toListingScale(1234, {})).toBe(1234);
    expect(toCurrentScale(1234, { splitFactor: 1 })).toBe(1234);
    expect(currentPriceAtListingScale({ currentPrice: 1234 })).toBe(1234);
  });

  it("現在値が無ければ null", () => {
    expect(currentPriceAtListingScale({ splitFactor: 6, currentPrice: null })).toBeNull();
    expect(currentPriceAtListingScale({ splitFactor: 6 })).toBeNull();
  });
});

describe("formatSplitRatio", () => {
  it("分割比を 1:N で示す", () => {
    expect(formatSplitRatio({ splitFactor: 6 })).toBe("1:6");
    expect(formatSplitRatio({ splitFactor: 2 })).toBe("1:2");
  });

  it("整数倍でない分割・併合も整数比にする", () => {
    expect(formatSplitRatio({ splitFactor: 1.5 })).toBe("2:3");
    expect(formatSplitRatio({ splitFactor: 0.1 })).toBe("10:1");
  });

  it("分割なしは null", () => {
    expect(formatSplitRatio({})).toBeNull();
    expect(formatSplitRatio({ splitFactor: 1 })).toBeNull();
  });
});
