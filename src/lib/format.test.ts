import { describe, expect, it } from "vitest";
import { formatShortDate } from "./format";

describe("formatShortDate", () => {
  it("日本時間の今年の日付は M/D（ゼロ埋めなし）", () => {
    expect(formatShortDate("2026-11-27", "2026-11-22")).toBe("11/27");
    expect(formatShortDate("2026-01-05", "2026-11-22")).toBe("1/5");
  });

  it("今年以外（過去年・来年）は YYYY/M/D", () => {
    expect(formatShortDate("2025-11-27", "2026-11-22")).toBe("2025/11/27");
    expect(formatShortDate("2024-12-19", "2026-11-22")).toBe("2024/12/19");
    expect(formatShortDate("2027-01-08", "2026-12-28")).toBe("2027/1/8");
  });

  it("年の境目は todayIso の年で判定する", () => {
    expect(formatShortDate("2026-12-31", "2027-01-01")).toBe("2026/12/31");
    expect(formatShortDate("2027-01-01", "2027-01-01")).toBe("1/1");
  });

  it("ISO 日付として読めない値はそのまま返す", () => {
    expect(formatShortDate("", "2026-11-22")).toBe("");
    expect(formatShortDate("未定", "2026-11-22")).toBe("未定");
  });
});
