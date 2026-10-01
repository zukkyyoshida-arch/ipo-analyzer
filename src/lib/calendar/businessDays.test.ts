import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  firstBusinessDayOfMonth,
  hasHolidayTable,
  isBusinessDay,
  isHoliday,
  lastBusinessDayOfMonth,
  monthEndIso,
  nextBusinessDay,
  prevBusinessDay,
} from "./businessDays";

describe("営業日の判定", () => {
  it("土日は休み、平日は営業日", () => {
    expect(isBusinessDay("2026-10-03")).toBe(false); // 土
    expect(isBusinessDay("2026-10-04")).toBe(false); // 日
    expect(isBusinessDay("2026-10-05")).toBe(true); // 月
  });

  it("祝日・振替休日・国民の休日は休み", () => {
    expect(isHoliday("2026-10-12")).toBe(true); // スポーツの日
    expect(isBusinessDay("2026-05-06")).toBe(false); // 振替休日
    expect(isBusinessDay("2026-09-22")).toBe(false); // 国民の休日
    expect(isBusinessDay("2027-03-22")).toBe(false); // 春分の日の振替休日
    expect(isBusinessDay("2026-03-20")).toBe(false); // 春分の日
  });

  it("年末年始（12/31〜1/3）は休み", () => {
    expect(isBusinessDay("2026-12-30")).toBe(true);
    expect(isBusinessDay("2026-12-31")).toBe(false);
    expect(isBusinessDay("2027-01-01")).toBe(false);
    expect(isBusinessDay("2027-01-04")).toBe(true);
  });

  it("祝日表を持つ年", () => {
    expect(hasHolidayTable(2026)).toBe(true);
    expect(hasHolidayTable(2027)).toBe(true);
    expect(hasHolidayTable(2030)).toBe(false);
  });
});

describe("営業日を数える", () => {
  it("次・前の営業日は休日を飛ばす", () => {
    expect(nextBusinessDay("2026-10-09")).toBe("2026-10-13"); // 金 → 土日・祝日を飛ばして火
    expect(prevBusinessDay("2026-10-13")).toBe("2026-10-09");
  });

  it("n 営業日ずらす", () => {
    expect(addBusinessDays("2026-09-30", -2)).toBe("2026-09-28");
    expect(addBusinessDays("2026-09-18", 1)).toBe("2026-09-24"); // シルバーウィークを飛ばす
    expect(addBusinessDays("2026-09-18", 0)).toBe("2026-09-18");
  });

  it("月の最初・最後の営業日", () => {
    expect(firstBusinessDayOfMonth(2027, 1)).toBe("2027-01-04");
    expect(firstBusinessDayOfMonth(2026, 11)).toBe("2026-11-02"); // 11/1 は日曜
    expect(lastBusinessDayOfMonth(2026, 12)).toBe("2026-12-30");
    expect(lastBusinessDayOfMonth(2026, 5)).toBe("2026-05-29"); // 5/31 は日曜、5/30 は土曜
  });

  it("月末日（うるう年）", () => {
    expect(monthEndIso(2028, 2)).toBe("2028-02-29");
    expect(monthEndIso(2027, 2)).toBe("2027-02-28");
  });
});
