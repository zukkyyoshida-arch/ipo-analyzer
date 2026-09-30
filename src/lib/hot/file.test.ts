import { describe, expect, it } from "vitest";
import bundledHot from "../../../public/data/hot.json";
import {
  formatMonthDay,
  formatTurnoverJa,
  formatVolRatio,
  isHotStale,
  isOverheated,
  parseHotFile,
} from "./file";
import { HOT_BACKTEST, HOT_CAUTION_NOTE, overheatNote } from "./backtest";

const item = {
  code: "627A",
  name: "テスト",
  listingDate: "2026-09-18",
  score: 86,
  r5: 0.3159,
  r20: 0.3159,
  volRatio: null,
  highProx: 1,
  turnover5: 24207120767,
  initialRatio: 2.182,
  reasons: ["5日 +32%", "上場来高値圏"],
};

describe("parseHotFile", () => {
  it("正しい形はそのまま読む", () => {
    const f = parseHotFile({ asOf: "2026-09-29", generatedAt: "x", universe: 42, items: [item] });
    expect(f).toEqual({ asOf: "2026-09-29", generatedAt: "x", universe: 42, items: [item] });
  });

  it("asOf が日付でなければ null", () => {
    expect(parseHotFile(null)).toBeNull();
    expect(parseHotFile([])).toBeNull();
    expect(parseHotFile({ asOf: "", items: [] })).toBeNull();
    expect(parseHotFile({ asOf: "2026/09/29", items: [] })).toBeNull();
  });

  it("形の崩れた行は落とし、欠けた任意項目は既定値で埋める", () => {
    const f = parseHotFile({
      asOf: "2026-09-29",
      items: [
        item,
        { ...item, code: "" },
        { ...item, score: "90" },
        { ...item, code: "X", volRatio: "x", initialRatio: undefined, reasons: [1, "5日 +10%"], score: 120 },
        "壊れた行",
      ],
    });
    expect(f?.items.map((i) => i.code)).toEqual(["627A", "X"]);
    expect(f?.items[1]).toMatchObject({ volRatio: null, initialRatio: null, reasons: ["5日 +10%"], score: 100 });
    // universe が無ければ件数
    expect(f?.universe).toBe(2);
    expect(f?.generatedAt).toBe("");
  });

  it("同梱の hot.json を読める", () => {
    const f = parseHotFile(bundledHot);
    expect(f).not.toBeNull();
    expect(Array.isArray(f?.items)).toBe(true);
  });
});

describe("isHotStale", () => {
  it("7日以上前は古い", () => {
    expect(isHotStale("2026-09-29", "2026-09-30")).toBe(false);
    expect(isHotStale("2026-09-24", "2026-09-30")).toBe(false);
    expect(isHotStale("2026-09-23", "2026-09-30")).toBe(true);
  });

  it("日付でなければ古い扱い", () => {
    expect(isHotStale("", "2026-09-30")).toBe(true);
  });
});

describe("表示の整形", () => {
  it("formatMonthDay", () => {
    expect(formatMonthDay("2026-09-05")).toBe("9/5");
    expect(formatMonthDay("x")).toBe("x");
  });

  it("formatTurnoverJa", () => {
    expect(formatTurnoverJa(24207120767)).toBe("242億");
    expect(formatTurnoverJa(209_000_000)).toBe("2.1億");
    expect(formatTurnoverJa(123_456_789_012)).toBe("1,235億");
    expect(formatTurnoverJa(45_000_000)).toBe("4,500万");
    expect(formatTurnoverJa(0)).toBe("—");
  });

  it("formatVolRatio", () => {
    expect(formatVolRatio(3.16)).toBe("3.2倍");
    expect(formatVolRatio(null)).toBe("—");
  });

  it("isOverheated は注意ラインを超えたときだけ", () => {
    expect(isOverheated(1.5, 1.5)).toBe(false);
    expect(isOverheated(1.51, 1.5)).toBe(true);
    expect(isOverheated(null, 1.5)).toBe(false);
  });
});

describe("過去検証の注記", () => {
  it("注意ラインが 1.5 倍なら検証の数字を添える", () => {
    const note = overheatNote(1.5);
    expect(note).toContain("1.5倍超");
    expect(note).toContain("約35%");
    expect(note).toContain("約−5%");
  });

  it("ほかの注意ラインでは数字を出さない", () => {
    const note = overheatNote(2);
    expect(note).toContain("2.0倍");
    expect(note).not.toMatch(/約\d|%/);
  });

  it("常に出す注記は約半数・4件に1件", () => {
    expect(HOT_CAUTION_NOTE).toContain("約半数");
    expect(HOT_CAUTION_NOTE).toContain("4件に1件");
    // 検証の数字と食い違っていないこと
    expect(Math.round(HOT_BACKTEST.top10After20.upRatePct / 10) * 10).toBe(50);
    expect(HOT_BACKTEST.top10After20.downOver20Pct + HOT_BACKTEST.top10After20.upOver20Pct).toBe(25);
  });
});
