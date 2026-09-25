import { describe, it, expect } from "vitest";
import { computeMovingAverage } from "./movingAverage";

describe("computeMovingAverage", () => {
  it("件数が window 未満なら全て null", () => {
    expect(computeMovingAverage([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it("件数が window ちょうどなら最後の1点だけ値が入る", () => {
    expect(computeMovingAverage([1, 2, 3, 4, 5], 5)).toEqual([
      null,
      null,
      null,
      null,
      3,
    ]);
  });

  it("window 超過分はスライドして平均する", () => {
    expect(computeMovingAverage([1, 2, 3, 4, 5, 6], 3)).toEqual([
      null,
      null,
      2,
      3,
      4,
      5,
    ]);
  });

  it("window=1 は元の値そのまま", () => {
    expect(computeMovingAverage([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it("空配列は空配列、不正な window は全て null", () => {
    expect(computeMovingAverage([], 25)).toEqual([]);
    expect(computeMovingAverage([1, 2], 0)).toEqual([null, null]);
    expect(computeMovingAverage([1, 2], 1.5)).toEqual([null, null]);
  });

  it("25日移動平均: 30件なら先頭24件が null", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const ma = computeMovingAverage(closes, 25);
    expect(ma.slice(0, 24).every((v) => v === null)).toBe(true);
    expect(ma[24]).toBe(13);
    expect(ma[29]).toBe(18);
  });
});
