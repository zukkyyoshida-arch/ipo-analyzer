import { describe, expect, it } from "vitest";
import bundledPicks from "../../../public/data/yutai/picks.json";
import {
  businessDaysBetween,
  comparePicks,
  isPicksStale,
  median,
  parsePicksFile,
  PICK_RULE_THRESHOLDS,
  ruleMatches,
  selectPicks,
  summarizeHistory,
  targetPickMonths,
  type PickItem,
} from "./picksRules";

function pick(code: string, o: Partial<PickItem> = {}): PickItem {
  return {
    code,
    name: `銘柄${code}`,
    n: 10,
    win: 8,
    avg: 0.05,
    worst: -0.1,
    streak: 3,
    price: 1500,
    priceAsOf: "2026-10-02",
    invest: 150_000,
    minInvest: 150_000,
    aboveMa75: true,
    pos12: 0.5,
    ret1m: -0.02,
    sector: "小売業",
    nextEarningsDate: null,
    detailUrl: `https://example.com/${code}`,
    rules: [],
    ...o,
  };
}

describe("ruleMatches", () => {
  it("C は過去70%・5年以上・20万以下・市場マイナス、D は80%・8年以上・20万以下（市場条件なし）", () => {
    expect(ruleMatches(pick("1"), true)).toEqual(["C", "D"]);
    expect(ruleMatches(pick("1"), false)).toEqual(["D"]);
    // 7/10 は C だけ
    expect(ruleMatches(pick("2", { win: 7 }), true)).toEqual(["C"]);
    // 6/7（86%）でも 8 年未満なので D は付かない
    expect(ruleMatches(pick("3", { n: 7, win: 6 }), true)).toEqual(["C"]);
    // 4/4 は 5 年未満で何も付かない
    expect(ruleMatches(pick("4", { n: 4, win: 4 }), true)).toEqual([]);
    // 20 万円を超えると付かない
    expect(ruleMatches(pick("5", { invest: PICK_RULE_THRESHOLDS.C.maxInvest + 100 }), true)).toEqual([]);
  });

  it("B は C に加えて 10 万以下・75 日線の下（不明なら付かない）", () => {
    expect(ruleMatches(pick("1", { invest: 90_000, aboveMa75: false }), true)).toEqual(["B", "C", "D"]);
    expect(ruleMatches(pick("1", { invest: 90_000, aboveMa75: null }), true)).toEqual(["C", "D"]);
    expect(ruleMatches(pick("1", { invest: 90_000, aboveMa75: false }), false)).toEqual(["D"]);
  });
});

describe("selectPicks", () => {
  it("当てはまる銘柄だけを、勝率→年数→平均の順に並べる", () => {
    const items = [
      pick("a", { win: 7 }),
      pick("b", { win: 9, avg: 0.01 }),
      pick("c", { win: 9, avg: 0.03 }),
      pick("d", { n: 9, win: 9 }),
      pick("e", { invest: 300_000 }),
    ];
    const out = selectPicks(items, true);
    expect(out.map((p) => p.code)).toEqual(["d", "c", "b", "a"]);
    expect(out[0].rules).toEqual(["C", "D"]);
    expect([...out].sort(comparePicks).map((p) => p.code)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("summarizeHistory・median・businessDaysBetween", () => {
  it("年の順に並べて勝ち数・平均・最悪・直近からの連勝を出す", () => {
    expect(summarizeHistory([])).toBeNull();
    const s = summarizeHistory([
      { year: 2025, ret: 0.1 },
      { year: 2024, ret: 0.02 },
      { year: 2023, ret: -0.05 },
      { year: 2022, ret: 0.03 },
    ])!;
    expect(s).toMatchObject({ n: 4, win: 3, worst: -0.05, streak: 2 });
    expect(s.avg).toBeCloseTo(0.025);
  });

  it("中央値は null を除き、偶数個は中間", () => {
    expect(median([])).toBeNull();
    expect(median([null, 3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("営業日数は翌営業日から数える（土日・祝日を除く）", () => {
    // 2026-10-09（金）→ 10-13（火）: 10-12 はスポーツの日
    expect(businessDaysBetween("2026-10-09", "2026-10-13")).toBe(1);
    expect(businessDaysBetween("2026-10-06", "2026-10-06")).toBe(0);
  });
});

describe("targetPickMonths", () => {
  it("2026-10-06 は 11・12・1 月（権利付最終日まで 30〜90 営業日）", () => {
    const t = targetPickMonths("2026-10-06");
    expect(t.map((m) => m.month)).toEqual([11, 12, 1]);
    expect(t[1]).toMatchObject({ month: 12, year: 2026, lastCumDate: "2026-12-28" });
    expect(t[2].year).toBe(2027);
    for (const m of t) expect(m.entryDays).toBeGreaterThanOrEqual(30);
  });
});

describe("parsePicksFile", () => {
  const good = {
    generatedAt: "x",
    asOf: "2026-10-06",
    marketRet1m: -0.016,
    marketDown: true,
    months: [{ month: 12, year: 2026, lastCumDate: "2026-12-28", entryDays: 56, matched: 3, items: [pick("1111", { rules: ["C", "D"] })] }],
    note: { perTradeMax: 0.77, basketB: 0.85, basketC: 0.83, basketD: 0.76 },
  };

  it("正しい形はそのまま読む", () => {
    expect(parsePicksFile(good)).toEqual(good);
  });

  it("asOf が日付でなければ null、壊れた行・月・ルールの無い行は落とす", () => {
    expect(parsePicksFile({ ...good, asOf: "x" })).toBeNull();
    expect(parsePicksFile(null)).toBeNull();
    const f = parsePicksFile({
      ...good,
      months: [
        ...good.months.map((m) => ({
          ...m,
          items: [...m.items, { code: "2222" }, pick("3333", { rules: ["Z"] as never }), pick("4444", { win: 11 })],
        })),
        { month: 13, lastCumDate: "2026-12-28", entryDays: 1 },
      ],
    })!;
    expect(f.months).toHaveLength(1);
    expect(f.months[0].items.map((i) => i.code)).toEqual(["1111"]);
  });

  it("note・marketDown が無い古い形は既定で埋める", () => {
    const f = parsePicksFile({ asOf: "2026-10-06", marketRet1m: 0.01, months: [] })!;
    expect(f.marketDown).toBe(false);
    expect(f.note.perTradeMax).toBe(0.77);
  });

  it("リポジトリの picks.json が読める", () => {
    const f = parsePicksFile(bundledPicks);
    expect(f).not.toBeNull();
    for (const m of f!.months) for (const it of m.items) expect(it.rules.length).toBeGreaterThan(0);
  });
});

describe("isPicksStale", () => {
  it("7 日以上前は古い", () => {
    expect(isPicksStale("2026-10-06", "2026-10-12")).toBe(false);
    expect(isPicksStale("2026-10-06", "2026-10-13")).toBe(true);
    expect(isPicksStale("bad", "2026-10-13")).toBe(true);
  });
});
