import { describe, it, expect } from "vitest";
import {
  EVENT_STAT_KINDS,
  EVENT_WEAK_SAMPLE_THRESHOLD,
  eventSampleNote,
  eventYearsRange,
  getEventStats,
  parseEventStats,
} from "./eventStats";

const sample = {
  asOf: "2026-09-25",
  kinds: {
    lockupExpiry: {
      sampleCount: 129,
      meanBefore20: 0.64,
      meanAfter5: 0.46,
      meanAfter20: 4.48,
      medianAfter20: -0.07,
      winRateAfter20: 49.61,
      years: [
        { year: 2024, sampleCount: 40, medianAfter20: -3.1 },
        { year: 2026, sampleCount: 27, medianAfter20: 4.97 },
      ],
    },
    firstEarnings: {
      sampleCount: 3,
      meanBefore20: null,
      meanAfter5: 1,
      meanAfter20: 2,
      medianAfter20: 2,
      winRateAfter20: 66.67,
      years: [{ year: 2026, sampleCount: 3, medianAfter20: 2 }],
    },
  },
};

describe("parseEventStats", () => {
  it("正しい形をそのまま型付きで返す", () => {
    const s = parseEventStats(sample);
    expect(s.asOf).toBe("2026-09-25");
    expect(s.kinds.lockupExpiry?.sampleCount).toBe(129);
    expect(s.kinds.lockupExpiry?.medianAfter20).toBe(-0.07);
    expect(s.kinds.firstEarnings?.meanBefore20).toBeNull();
    expect(s.kinds.priceRelease15x).toBeUndefined();
  });

  it("不正な値・種別を落とす", () => {
    const s = parseEventStats({
      asOf: 1,
      kinds: {
        lockupExpiry: { sampleCount: "x" },
        priceRelease15x: {
          sampleCount: 5,
          meanAfter20: "NaN",
          years: [{ year: 2025 }, null, { year: 2024, sampleCount: 5, medianAfter20: 1 }],
        },
        unknownKind: { sampleCount: 1 },
      },
    });
    expect(s.asOf).toBe("");
    expect(s.kinds.lockupExpiry).toBeUndefined();
    expect(s.kinds.priceRelease15x?.meanAfter20).toBeNull();
    expect(s.kinds.priceRelease15x?.years).toEqual([
      { year: 2024, sampleCount: 5, medianAfter20: 1 },
    ]);
    expect(Object.keys(s.kinds)).not.toContain("unknownKind");
  });

  it("null や配列でも落ちない", () => {
    expect(parseEventStats(null)).toEqual({ asOf: "", kinds: {} });
    expect(parseEventStats([])).toEqual({ asOf: "", kinds: {} });
  });
});

describe("eventSampleNote", () => {
  it("0件は null", () => {
    expect(eventSampleNote(0)).toBeNull();
  });
  it("閾値未満は目安として弱い", () => {
    expect(eventSampleNote(EVENT_WEAK_SAMPLE_THRESHOLD - 1)).toContain("目安として弱い");
  });
  it("閾値以上は母数のみ", () => {
    expect(eventSampleNote(EVENT_WEAK_SAMPLE_THRESHOLD)).toBe(
      `母数${EVENT_WEAK_SAMPLE_THRESHOLD}件`,
    );
  });
});

describe("eventYearsRange", () => {
  it("年の範囲を返す", () => {
    const s = parseEventStats(sample);
    expect(eventYearsRange(s.kinds.lockupExpiry!)).toBe("2024〜2026年");
    expect(eventYearsRange(s.kinds.firstEarnings!)).toBe("2026年");
  });
  it("年が無ければ空文字", () => {
    const s = parseEventStats({ kinds: { lockupExpiry: { sampleCount: 0, years: [] } } });
    expect(eventYearsRange(s.kinds.lockupExpiry!)).toBe("");
  });
});

describe("getEventStats（同梱JSON）", () => {
  it("同梱ファイルが読めて全種別を持つ", () => {
    const s = getEventStats();
    expect(s.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const kind of EVENT_STAT_KINDS) {
      expect(s.kinds[kind]).toBeDefined();
    }
  });
});
