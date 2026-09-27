import { describe, expect, it } from "vitest";
import { needsInitialRefetch, pickInitialQuote } from "./initial";

describe("pickInitialQuote", () => {
  it("出来高 0 の穴埋め行を飛ばして最初の取引足を返す", () => {
    const quotes = [
      { open: 55319998464, volume: 0 },
      { open: 1632, volume: 79182300 },
      { open: 1813, volume: 53695000 },
    ];
    expect(pickInitialQuote(quotes)?.open).toBe(1632);
  });

  it("始値が無い足も飛ばす", () => {
    const quotes = [
      { open: null, volume: 1000 },
      { open: 2284, volume: 772200 },
    ];
    expect(pickInitialQuote(quotes)?.open).toBe(2284);
  });

  it("取引のある足が無ければ undefined", () => {
    expect(pickInitialQuote([{ open: 100, volume: 0 }])).toBeUndefined();
    expect(pickInitialQuote([])).toBeUndefined();
  });
});

describe("needsInitialRefetch", () => {
  it("未取得なら取り直す", () => {
    expect(needsInitialRefetch({})).toBe(true);
    expect(needsInitialRefetch({ initialPrice: 1000 })).toBe(true);
  });

  it("出来高 0 は穴埋め行を拾った可能性があるので取り直す", () => {
    expect(needsInitialRefetch({ initialPrice: 55319998464, initialVolume: 0 })).toBe(true);
  });

  it("初値と出来高が揃っていれば取り直さない", () => {
    expect(needsInitialRefetch({ initialPrice: 2284, initialVolume: 772200 })).toBe(false);
  });
});
