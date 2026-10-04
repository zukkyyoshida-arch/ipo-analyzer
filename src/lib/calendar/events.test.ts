import { describe, expect, it } from "vitest";
import {
  buildCalendarItems,
  groupByDate,
  monthGrid,
  parseManualEvents,
  relativeDayLabel,
  shiftMonth,
  soonItems,
  type ManualEvent,
} from "./events";

const manual: ManualEvent[] = [
  { id: "m1", code: "9984", name: "", date: "2026-10-05", kind: "sell", memo: "半分売る" },
  { id: "m2", code: "", name: "", date: "2026-11-02", kind: "other", memo: "" },
];

describe("手動の予定の読み込み", () => {
  it("形の崩れた行は落とし、不明な種類は「その他」", () => {
    const parsed = parseManualEvents([
      { id: "a", date: "2026-10-01", kind: "buy" },
      { id: "b", date: "10/1", kind: "buy" },
      { id: "c", date: "2026-10-02", kind: "???" },
      null,
    ]);
    expect(parsed.map((e) => [e.id, e.kind])).toEqual([
      ["a", "buy"],
      ["c", "other"],
    ]);
    expect(parseManualEvents("x")).toEqual([]);
  });
});

describe("予定の組み立て", () => {
  const items = buildCalendarItems({
    manual,
    fromIso: "2026-10-01",
    toIso: "2026-10-31",
  });

  it("優待の自動の予定・手動の予定が日付順に並ぶ", () => {
    expect(items.map((i) => [i.date, i.title])).toEqual([
      ["2026-10-01", "11月権利 買い開始"],
      ["2026-10-05", "9984 売り"],
      ["2026-10-28", "10月権利 権利付最終日"],
      ["2026-10-29", "10月権利 権利落ち日"],
      ["2026-10-29", "10月権利 売却資金 → 12月権利に備える"],
    ]);
  });

  it("権利落ち日に、売却資金を回す先（M+2 月権利・買い開始は翌月初）の案内が出る", () => {
    const roll = items.find((i) => i.kind === "yutaiRoll");
    expect(roll).toMatchObject({ date: "2026-10-29", source: "yutai", memo: "買い開始は 11/2" });
    const dec = buildCalendarItems({ manual: [], fromIso: "2026-12-01", toIso: "2026-12-31" });
    expect(dec.find((i) => i.kind === "yutaiRoll")?.title).toBe("12月権利 売却資金 → 2月権利に備える");
  });

  it("手動の予定だけ manualId を持つ", () => {
    expect(items.filter((i) => i.manualId).map((i) => i.manualId)).toEqual(["m1"]);
  });
});

describe("今週の予定・まとめ", () => {
  const items = buildCalendarItems({
    manual,
    fromIso: "2026-09-01",
    toIso: "2026-11-30",
  });

  it("今日から 3 日以内", () => {
    expect(soonItems(items, "2026-10-02").map((i) => i.date)).toEqual(["2026-10-05"]);
    expect(soonItems(items, "2026-10-01").map((i) => i.date)).toEqual(["2026-10-01"]);
  });

  it("近さの表記", () => {
    expect(relativeDayLabel("2026-10-02", "2026-10-02")).toBe("今日");
    expect(relativeDayLabel("2026-10-03", "2026-10-02")).toBe("明日");
    expect(relativeDayLabel("2026-10-05", "2026-10-02")).toBe("3日後");
    expect(relativeDayLabel("2026-10-01", "2026-10-02")).toBe("1日前");
  });

  it("日付ごとにまとめる", () => {
    const groups = groupByDate(items.filter((i) => i.date.startsWith("2026-10")));
    expect(groups.find((g) => g.date === "2026-10-28")?.items).toHaveLength(1);
  });
});

describe("月の枠", () => {
  it("日曜始まりで 7 マスずつ（2026年10月は木曜始まり・5 週）", () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(weeks[4]).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });

  it("月送りは年をまたぐ", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
