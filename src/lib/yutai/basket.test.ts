import { describe, expect, it } from "vitest";
import { basketBacktest, basketYear, summarizeBasket } from "./basket";
import type { YutaiItem } from "./types";

/** rets: 2016 年から順の年リターン。maxHighRet は max(ret,0)+0.02 とする。 */
function item(code: string, rets: (number | null)[], startYear = 2016): YutaiItem {
  const years = rets.flatMap((ret, i) =>
    ret === null
      ? []
      : [{ year: startYear + i, ret, hit10: ret + 0.02 >= 0.1, maxHighRet: Math.max(ret, 0) + 0.02 }],
  );
  return { code, name: code, rights: { years } } as unknown as YutaiItem;
}

const YEARS = [2021, 2022];

describe("basketYear", () => {
  const items = [
    item("A", [0.1, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]), // 強い（過去 5 年すべて勝ち）
    item("B", [-0.1, -0.1, -0.1, -0.1, -0.1, 0.2, 0.2]), // 弱い
    item("C", [0.02, -0.02, 0.02, -0.02, 0.02, 0.0, 0.1]),
  ];

  it("過去（year < Y）の成績で順位付けし、上位 topN の均等平均を返す", () => {
    const y = basketYear(items, 2021, 1);
    expect(y.codes).toEqual(["A"]);
    expect(y.ret).toBeCloseTo(0.05);
    const y2 = basketYear(items, 2021, 2);
    expect(y2.n).toBe(2);
    expect(y2.ret).toBeCloseTo((0.05 + 0.0) / 2);
  });

  it("Y の ret を変えても Y の順位付けは変わらない（先読みなし）", () => {
    const tweaked = items.map((it) => item(it.code, it.rights!.years.map((r) => (r.year === 2021 ? 0.9 : r.ret))));
    expect(basketYear(tweaked, 2021, 2).codes).toEqual(basketYear(items, 2021, 2).codes);
    // 逆に Y より前の成績を変えると順位は変わる
    const flipped = [item("A", [-0.1, -0.1, -0.1, -0.1, -0.1, 0.05]), item("B", [0.1, 0.1, 0.1, 0.1, 0.1, 0.2])];
    expect(basketYear(flipped, 2021, 1).codes).toEqual(["B"]);
  });

  it("過去の年数が 5 年未満の銘柄は候補から外れる", () => {
    const short = [item("S", [0.5, 0.5, 0.5, 0.5], 2017), ...items]; // 2021 年時点で 2017〜20 の 4 年
    expect(basketYear(short, 2021, 5).codes).not.toContain("S");
  });

  it("topN に満たない年は取れた銘柄数で平均し、0 銘柄なら null", () => {
    expect(basketYear(items, 2021, 5).n).toBe(3);
    const none = basketYear(items, 2018, 3); // 過去 2 年しかない
    expect(none).toEqual({ year: 2018, ret: null, n: 0, codes: [] });
  });

  it("上位でもその年の成績が無い銘柄は平均に入れない", () => {
    const gap = [item("A", [0.1, 0.1, 0.1, 0.1, 0.1, null]), item("B", [0.0, 0.0, 0.0, 0.0, 0.0, 0.3])];
    const y = basketYear(gap, 2021, 2);
    expect(y.codes).toEqual(["B"]);
    expect(y.ret).toBeCloseTo(0.3);
  });
});

describe("summarizeBasket / basketBacktest", () => {
  it("勝ち年数・平均・最大ドローダウン・最良/最悪年", () => {
    const mk = (year: number, ret: number | null) => ({ year, ret, n: ret === null ? 0 : 1, codes: [] });
    const s = summarizeBasket(3, [mk(2016, 0.1), mk(2017, -0.2), mk(2018, -0.1), mk(2019, 0.5), mk(2020, null)]);
    expect(s.n).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.avgRet).toBeCloseTo(0.075);
    // 資産 1.1 → 0.88 → 0.792 → 1.188。ピーク 1.1 からの最大下落 = 0.792/1.1 − 1 = −0.28
    expect(s.maxDrawdown).toBeCloseTo(-0.28);
    expect(s.best).toEqual({ year: 2019, ret: 0.5 });
    expect(s.worst).toEqual({ year: 2017, ret: -0.2 });
  });

  it("年が全て null なら集計は null", () => {
    const s = summarizeBasket(3, [{ year: 2016, ret: null, n: 0, codes: [] }]);
    expect(s).toMatchObject({ n: 0, wins: 0, avgRet: null, maxDrawdown: null, best: null, worst: null });
  });

  it("topN 省略で 3 と 5 の両方、指定でその 1 通りを返す", () => {
    const items = [
      item("A", [0.1, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]),
      item("B", [-0.1, -0.1, -0.1, -0.1, -0.1, 0.2, 0.2]),
    ];
    const r = basketBacktest(items, { years: YEARS });
    expect(Object.keys(r.byTopN)).toEqual(["3", "5"]);
    expect(r.byTopN["3"].years.map((y) => y.year)).toEqual(YEARS);
    expect(r.byTopN["3"].avgRet).toBeCloseTo((0.125 + 0.125) / 2); // 2 銘柄の均等平均 (0.05+0.2)/2
    expect(Object.keys(basketBacktest(items, { topN: 1, years: YEARS }).byTopN)).toEqual(["1"]);
  });
});
