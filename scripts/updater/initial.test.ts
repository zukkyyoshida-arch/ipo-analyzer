import { describe, expect, it } from "vitest";
import { pickInitialQuote } from "./initial";

describe("pickInitialQuote", () => {
  it("出来高 0 の穴埋め行を飛ばして最初の取引足を返す", () => {
    const quotes = [
      { open: 264.75, volume: 0 },
      { open: 1850, volume: 4255900 },
      { open: 1748, volume: 2598100 },
    ];
    expect(pickInitialQuote(quotes)?.open).toBe(1850);
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
