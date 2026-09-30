import { describe, it, expect } from "vitest";
import { barDomain, barExtent, cleanValue, labelIndices, niceTicks, yPercent } from "./barScale";

/** 目盛りが 2 本以上・重複なし・昇順であること（BarChart の key と縦位置が衝突しない条件）。 */
function expectHealthyTicks(ticks: number[]) {
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ticks).size).toBe(ticks.length);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
}

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

  it("絶対値が 1e-6 未満だけの範囲は 0 とみなし、全部 0 のときと同じ 0〜1 の目盛りになる", () => {
    expect(niceTicks(1e-7, 1e-7)).toEqual(niceTicks(0, 0));
    expect(niceTicks(0, 1e-15)).toEqual(niceTicks(0, 0));
    expect(niceTicks(-1e-7, 1e-7)).toEqual(niceTicks(0, 0));
    expect(niceTicks(1e-7, 1e-7, { integer: true })).toEqual([0, 1]);
  });

  it("小さな範囲でも刻みが 0 に潰れず、目盛りが 2 本以上・重複なしになる", () => {
    for (const [lo, hi] of [
      [0, 2e-6],
      [0, 3e-6],
      [2e-6, 3e-6],
      [-4e-6, 0],
      [0, 1e-3],
      [-1e-3, 1e-3],
    ]) {
      expectHealthyTicks(niceTicks(lo, hi));
    }
    expect(niceTicks(0, 2e-6).at(-1)).toBeGreaterThanOrEqual(2e-6);
  });

  it("浮動小数の誤差（0.1 刻みなど）は丸めて、きれいな値を返す", () => {
    expect(niceTicks(0, 0.3)).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe("cleanValue", () => {
  it("null と非有限（NaN / Infinity）は null、ごく小さい値は 0、それ以外はそのまま", () => {
    expect(cleanValue(null)).toBeNull();
    expect(cleanValue(Number.NaN)).toBeNull();
    expect(cleanValue(Infinity)).toBeNull();
    expect(cleanValue(-Infinity)).toBeNull();
    expect(cleanValue(1e-15)).toBe(0);
    expect(cleanValue(-1e-7)).toBe(0);
    expect(cleanValue(1e-6)).toBe(1e-6);
    expect(cleanValue(-12.5)).toBe(-12.5);
    expect(cleanValue(0)).toBe(0);
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

  it("1e-6 未満の非ゼロ値だけでも 0 とみなし、範囲が 0〜0 に潰れない（目盛りの key が重複しない）", () => {
    for (const values of [[1e-7], [-1e-7], [1e-15, 0], [1e-15, -1e-15, null], [5e-7, 5e-7]]) {
      const d = barDomain(values);
      expect(d).not.toBeNull();
      expectHealthyTicks(d!.ticks);
      expect(d!.min).toBeLessThan(d!.max);
      expect(d!.min).toBeLessThanOrEqual(0);
      expect(d!.max).toBeGreaterThanOrEqual(0);
    }
    expect(barDomain([1e-7])).toEqual(barDomain([0]));
    expect(barDomain([1e-7])?.max).toBe(1);
    expect(barDomain([1e-15, 0], { integer: true })?.ticks).toEqual([0, 1]);
  });

  it("1e-15 と実際の値が混ざっても、誤差の値は範囲に影響しない", () => {
    expect(barDomain([1e-15, 60])).toEqual(barDomain([0, 60]));
    expect(barDomain([-1e-15, 60])).toEqual(barDomain([0, 60]));
  });

  it("NaN / Infinity は値なし扱いで範囲から除く（全部そうなら null）", () => {
    expect(barDomain([Number.NaN, Infinity, -Infinity, 60])).toEqual(barDomain([60]));
    expect(barDomain([Infinity, Number.NaN])).toBeNull();
    const d = barDomain([Infinity, -30, Number.NaN, 45]);
    expect(d).not.toBeNull();
    expectHealthyTicks(d!.ticks);
    expect(Number.isFinite(d!.min) && Number.isFinite(d!.max)).toBe(true);
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
