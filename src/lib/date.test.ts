import { describe, it, expect } from "vitest";
import { addDaysIso, daysBetween } from "./date";

describe("addDaysIso", () => {
  it("月末を跨ぐと翌月に繰り上がる", () => {
    expect(addDaysIso("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("年末を跨ぐと翌年に繰り上がる", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("うるう年は 2/29 を挟む", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("負の日数で過去日になる", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("ロックアップ90日・180日相当の加算", () => {
    expect(addDaysIso("2026-07-01", 90)).toBe("2026-09-29");
    expect(addDaysIso("2026-07-01", 180)).toBe("2026-12-28");
  });
});

describe("daysBetween", () => {
  it("同日は0", () => {
    expect(daysBetween("2026-09-25", "2026-09-25")).toBe(0);
  });

  it("月末を跨ぐ差", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
  });

  it("うるう年の2月を含む差", () => {
    expect(daysBetween("2028-02-01", "2028-03-01")).toBe(29);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(28);
  });

  it("to が前なら負の差", () => {
    expect(daysBetween("2026-09-25", "2026-09-20")).toBe(-5);
  });

  it("addDaysIso と往復で一致する", () => {
    expect(daysBetween("2026-01-15", addDaysIso("2026-01-15", 400))).toBe(400);
  });
});
