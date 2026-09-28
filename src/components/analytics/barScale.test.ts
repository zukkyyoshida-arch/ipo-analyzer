import { describe, it, expect } from "vitest";
import { barDomain, barExtent, labelIndices, niceTicks, yPercent } from "./barScale";

describe("niceTicks", () => {
  it("率（0〜100%）はきりの良い刻みで 0 と上端を含む", () => {
    expect(niceTicks(0, 100)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 60)).toEqual([0, 20, 40, 60]);
  });

  it("正負をまたぐ範囲は 0 を目盛りに含み、5 本以内に収める", () => {
    const t = niceTicks(-20, 150);
    expect(t).toContain(0);
    expect(t.length).toBeLessThanOrEqual(5);
    expect(t[0]).toBeLessThanOrEqual(-20);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(150);
  });

  it("件数（integer）は 0.5 などの半端な刻みを出さない", () => {
    expect(niceTicks(0, 1, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(0, 3, { integer: true })).toEqual([0, 1, 2, 3]);
    for (const t of niceTicks(0, 7, { integer: true })) expect(Number.isInteger(t)).toBe(true);
  });

  it("全部 0 でも 0〜1 の範囲を返す（マイナスの目盛りを作らない）", () => {
    expect(niceTicks(0, 0, { integer: true })).toEqual([0, 1]);
  });
});

describe("barDomain", () => {
  it("null（値なし）は範囲の計算から除き、範囲は必ず 0 を含む", () => {
    const d = barDomain([null, 30, null, 60]);
    expect(d?.min).toBe(0);
    expect(d?.max).toBeGreaterThanOrEqual(60);
  });

  it("全部マイナスでも上端は 0（棒は 0 から下へ伸びる）", () => {
    const d = barDomain([-12, -40]);
    expect(d?.max).toBe(0);
    expect(d?.min).toBeLessThanOrEqual(-40);
  });

  it("値が 1 つも無ければ null（グラフではなく空表示にする）", () => {
    expect(barDomain([null, null])).toBeNull();
    expect(barDomain([])).toBeNull();
  });
});

describe("barExtent", () => {
  it("プラスは基準線から上、マイナスは基準線から下に伸びる", () => {
    const up = barExtent(50, -50, 100);
    const down = barExtent(-25, -50, 100);
    const base = yPercent(0, -50, 100);
    expect(up.baseline).toBeCloseTo(base);
    expect(up.negative).toBe(false);
    expect(up.length).toBeCloseTo((50 / 150) * 100);
    expect(down.negative).toBe(true);
    expect(down.length).toBeCloseTo((25 / 150) * 100);
  });

  it("0 は長さ 0（描画側で基準線上の印にする）", () => {
    expect(barExtent(0, 0, 10).length).toBe(0);
  });
});

describe("labelIndices", () => {
  it("本数が少なければ全部出す", () => {
    expect(labelIndices(3)).toEqual([0, 1, 2]);
  });

  it("最新（右端）を必ず含め、等間隔に間引く", () => {
    expect(labelIndices(13)).toEqual([0, 4, 8, 12]);
    expect(labelIndices(5)).toEqual([0, 2, 4]);
    expect(labelIndices(32)).toEqual([7, 15, 23, 31]);
    const many = labelIndices(141);
    expect(many[many.length - 1]).toBe(140);
    expect(many.length).toBeLessThanOrEqual(4);
  });

  it("0 本なら空", () => {
    expect(labelIndices(0)).toEqual([]);
  });
});
