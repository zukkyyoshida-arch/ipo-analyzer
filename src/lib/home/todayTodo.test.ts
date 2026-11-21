import { describe, expect, it } from "vitest";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import { DEFAULT_BROKERS } from "@/data/brokers";
import { ipoScheduleEventsInRange } from "@/lib/events";
import { defaultRecordBroker, nextTodoItems, todayTodoItems } from "./todayTodo";

const TODAY = "2026-10-21";

describe("todayTodoItems", () => {
  it("今日・明日の BB 締切・抽選・購入期限・上場を拾い、BB 締切と抽選だけ記録できる", () => {
    const a = makeIpo({
      code: "652A",
      name: "トグルHD",
      bbPeriod: { start: "2026-10-15", end: "2026-10-21" },
      allotmentDate: "2026-10-22",
      purchasePeriod: { start: "2026-10-23", end: "2026-10-28" },
      listingDate: "2026-11-02",
    });
    const b = makeIpo({
      code: "640A",
      name: "上場銘柄",
      bbPeriod: { start: "2026-10-01", end: "2026-10-07" },
      purchasePeriod: { start: "2026-10-15", end: "2026-10-22" },
      listingDate: "2026-10-21",
    });
    const items = todayTodoItems([a, b], TODAY);
    expect(items.map((i) => [i.when, i.label, i.ipo.code, i.recordable])).toEqual([
      ["today", "BB締切", "652A", true],
      ["today", "上場", "640A", false],
      ["tomorrow", "抽選発表", "652A", true],
      ["tomorrow", "購入期限", "640A", false],
    ]);
  });

  it("BB 開始・購入開始・明後日以降・過ぎた日は出さない", () => {
    const a = makeIpo({
      bbPeriod: { start: "2026-10-21", end: "2026-10-27" },
      allotmentDate: "2026-10-28",
      purchasePeriod: { start: "2026-10-22", end: "2026-10-30" },
      listingDate: "2026-11-05",
    });
    const b = makeIpo({ code: "1111", bbPeriod: { start: "2026-10-10", end: "2026-10-20" }, listingDate: "" });
    expect(todayTodoItems([a, b], TODAY)).toEqual([]);
  });

  it("ロックアップ解除日も今日・明日なら出す", () => {
    const ipo = makeIpo({ listingDate: "2026-04-24", lockup: { days: 180, hasPriceRelease: false, coverage: 60 } });
    const items = todayTodoItems([ipo], TODAY);
    expect(items.map((i) => [i.label, i.date])).toEqual([["ロック解除", "2026-10-21"]]);
  });
});

describe("nextTodoItems", () => {
  const NO_LOCKUP = { days: 0, hasPriceRelease: false, coverage: 0 };

  it("今日以降で最も近い日の予定を返す（BB 開始も含む・あと何日付き）", () => {
    const nota = makeIpo({
      code: "673A",
      name: "NOTA",
      bbPeriod: { start: "2026-10-23", end: "2026-10-27" },
      listingDate: "2026-11-05",
      lockup: NO_LOCKUP,
    });
    const later = makeIpo({ code: "700A", bbPeriod: { start: "2026-10-26", end: "2026-10-30" }, listingDate: "", lockup: NO_LOCKUP });
    const past = makeIpo({ code: "600A", bbPeriod: { start: "2026-10-01", end: "2026-10-07" }, listingDate: "2026-10-20", lockup: NO_LOCKUP });
    const items = nextTodoItems([later, nota, past], TODAY);
    expect(items.map((i) => [i.label, i.ipo.code, i.date, i.daysUntil])).toEqual([["BB開始", "673A", "2026-10-23", 2]]);
  });

  it("同じ日に重なれば最大3件（種別順→コード順）", () => {
    const ipos = ["801A", "802A", "803A", "804A"].map((code) =>
      makeIpo({ code, bbPeriod: { start: "2026-10-25", end: "2026-10-29" }, listingDate: "", lockup: NO_LOCKUP }),
    );
    const listing = makeIpo({ code: "900A", bbPeriod: { start: "", end: "" }, listingDate: "2026-10-25", lockup: NO_LOCKUP });
    const items = nextTodoItems([listing, ...ipos], TODAY);
    expect(items.map((i) => [i.label, i.ipo.code])).toEqual([
      ["BB開始", "801A"],
      ["BB開始", "802A"],
      ["BB開始", "803A"],
    ]);
  });

  it("今日の BB 開始は daysUntil 0、未来の予定が無ければ空", () => {
    const today = makeIpo({ bbPeriod: { start: TODAY, end: "2026-10-27" }, listingDate: "", lockup: NO_LOCKUP });
    expect(nextTodoItems([today], TODAY).map((i) => i.daysUntil)).toEqual([0]);
    const past = makeIpo({ bbPeriod: { start: "2026-09-01", end: "2026-09-05" }, listingDate: "2026-09-20", lockup: NO_LOCKUP });
    expect(nextTodoItems([past], TODAY)).toEqual([]);
  });
});

describe("ipoScheduleEventsInRange", () => {
  it("範囲内なら今日より前の日も含め、kinds で絞れる", () => {
    const ipo = makeIpo({ bbPeriod: { start: "2026-10-01", end: "2026-10-07" }, listingDate: "2026-10-20" });
    const all = ipoScheduleEventsInRange([ipo], "2026-10-01", "2026-10-31");
    expect(all.map((e) => e.kind)).toEqual(["bbStart", "bbEnd", "listing"]);
    const only = ipoScheduleEventsInRange([ipo], "2026-10-01", "2026-10-31", ["bbEnd"]);
    expect(only.map((e) => e.date)).toEqual(["2026-10-07"]);
    expect(ipoScheduleEventsInRange([ipo], "2026-10-31", "2026-10-01")).toEqual([]);
  });
});

describe("defaultRecordBroker", () => {
  it("主幹事を証券会社マスタから探す（共同主幹事はマスタ順で先に当たる社）", () => {
    expect(defaultRecordBroker(makeIpo({ leadUnderwriter: "野村證券" }), DEFAULT_BROKERS)?.id).toBe("nomura");
    expect(defaultRecordBroker(makeIpo({ leadUnderwriter: "SBI証券・大和証券" }), DEFAULT_BROKERS)?.id).toBe("sbi");
  });

  it("主幹事がマスタに無ければ幹事団から、それも無ければ null", () => {
    expect(
      defaultRecordBroker(makeIpo({ leadUnderwriter: "東海東京証券", underwriters: ["東海東京証券", "SBI証券"] }), DEFAULT_BROKERS)?.id,
    ).toBe("sbi");
    expect(defaultRecordBroker(makeIpo({ leadUnderwriter: "", underwriters: [] }), DEFAULT_BROKERS)).toBeNull();
  });
});
