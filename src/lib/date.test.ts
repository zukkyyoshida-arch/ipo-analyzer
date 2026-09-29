import { afterEach, describe, it, expect, vi } from "vitest";
import { addDaysIso, daysBetween, formatJstDateTime, jstTodayIso } from "./date";

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

describe("jstTodayIso", () => {
  it("JST 7:59（UTC 前日 22:59）でも JST の日付になる", () => {
    expect(jstTodayIso(new Date("2026-09-29T22:59:00Z"))).toBe("2026-09-30");
  });

  it("JST 0:00 ちょうど（UTC 前日 15:00）で日付が進む", () => {
    expect(jstTodayIso(new Date("2026-09-29T14:59:59.999Z"))).toBe("2026-09-29");
    expect(jstTodayIso(new Date("2026-09-29T15:00:00Z"))).toBe("2026-09-30");
    expect(jstTodayIso(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09-30");
    expect(jstTodayIso(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10-01");
  });

  it("月末・年末を跨ぐ", () => {
    expect(jstTodayIso(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(jstTodayIso(new Date("2028-02-28T15:00:00Z"))).toBe("2028-02-29");
  });

  describe("now 省略時は現在時刻（fake timers）を使う", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("JST 7:59 は当日、JST 0:00 で翌日になる", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T22:59:00Z"));
      expect(jstTodayIso()).toBe("2026-09-30");
      vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
      expect(jstTodayIso()).toBe("2026-10-01");
    });
  });

  describe("実行環境のタイムゾーンに依存しない（サーバー UTC でもブラウザ JST でも同じ）", () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland"])(
      "TZ=%s",
      (tz) => {
        process.env.TZ = tz;
        expect(jstTodayIso(new Date("2026-09-29T22:59:00Z"))).toBe("2026-09-30");
        expect(jstTodayIso(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10-01");
      },
    );
  });
});

describe("formatJstDateTime", () => {
  it("UTC の ISO 日時を日本時間の YYYY/MM/DD HH:mm にする", () => {
    expect(formatJstDateTime("2026-09-25T09:01:00Z")).toBe("2026/09/25 18:01");
  });

  it("日付を跨ぐ（UTC 前日 15:30 は JST 0:30）", () => {
    expect(formatJstDateTime("2026-09-29T15:30:00Z")).toBe("2026/09/30 00:30");
  });

  it("パースできない値はそのまま返す", () => {
    expect(formatJstDateTime("not-a-date")).toBe("not-a-date");
  });

  it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles"])("TZ=%s でも同じ結果", (tz) => {
    const original = process.env.TZ;
    try {
      process.env.TZ = tz;
      expect(formatJstDateTime("2026-09-25T09:01:00Z")).toBe("2026/09/25 18:01");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
