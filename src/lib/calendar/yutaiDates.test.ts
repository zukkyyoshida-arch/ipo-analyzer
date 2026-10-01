import { describe, expect, it } from "vitest";
import { daysUntilLastCum, nextYutaiSchedule, yutaiSchedule, yutaiSchedulesInRange } from "./yutaiDates";

describe("優待の売買日付", () => {
  it("3月権利（2026）: 買い開始 2/2、権利付最終日 3/27、権利落ち日 3/30", () => {
    expect(yutaiSchedule(2026, 3)).toEqual({
      year: 2026,
      month: 3,
      buyStart: "2026-02-02",
      lastCumDate: "2026-03-27",
      exDate: "2026-03-30",
    });
  });

  it("9月権利（2026）: 権利付最終日は月末 9/30 の 2 営業日前の 9/28", () => {
    const s = yutaiSchedule(2026, 9);
    expect(s.buyStart).toBe("2026-08-03"); // 8/1 は土曜
    expect(s.lastCumDate).toBe("2026-09-28");
    expect(s.exDate).toBe("2026-09-29");
  });

  it("12月権利: 大納会 12/30 の 2 営業日前", () => {
    const s = yutaiSchedule(2026, 12);
    expect(s.lastCumDate).toBe("2026-12-28");
    expect(s.exDate).toBe("2026-12-29");
  });

  it("1月権利の買い開始日は前年 12 月の最初の営業日", () => {
    expect(yutaiSchedule(2027, 1).buyStart).toBe("2026-12-01");
  });

  it("権利落ち日が祝日をまたぐ（2027年3月: 月末 3/31 → 権利付最終日 3/29、落ち日 3/30）", () => {
    const s = yutaiSchedule(2027, 3);
    expect(s.lastCumDate).toBe("2027-03-29");
    expect(s.exDate).toBe("2027-03-30");
  });

  it("次の権利付最終日（過ぎていれば来年）", () => {
    expect(nextYutaiSchedule(9, "2026-09-28").lastCumDate).toBe("2026-09-28");
    expect(nextYutaiSchedule(9, "2026-09-29").year).toBe(2027);
    expect(daysUntilLastCum(12, "2026-12-25")).toBe(3);
    expect(daysUntilLastCum(10, "2026-10-01")).toBe(27); // 10/28
  });

  it("範囲に入る月の一覧（買い開始日だけ入る月も含む）", () => {
    const months = yutaiSchedulesInRange("2026-10-01", "2026-10-31").map((s) => `${s.year}-${s.month}`);
    // 9月権利の落ち日は 9/29 で範囲外。11月権利は買い開始日 10/1 が入る。
    expect(months).toEqual(["2026-10", "2026-11"]);
  });
});
