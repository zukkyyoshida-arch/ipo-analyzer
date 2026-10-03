import { describe, expect, it } from "vitest";
import {
  buildForeignFile,
  freshForeignItem,
  isForeignStale,
  parseForeignFile,
  sameForeignContent,
} from "./file";
import type { ForeignItem } from "../../types/foreign";

const item: ForeignItem = {
  ratioPercent: 12.3,
  fiscalYearEnd: "2026-03-31",
  submitDate: "2026-06-26",
  docId: "S100ABCD",
  prevRatioPercent: 8.1,
  prevFiscalYearEnd: "2025-03-31",
};

describe("parseForeignFile", () => {
  it("正しい形を読み、壊れた 1 件だけ捨てる", () => {
    const f = parseForeignFile({
      generatedAt: "2026-10-03T00:00:00.000Z",
      scannedThrough: "2026-10-02",
      items: {
        "8041": item,
        "9999": { ratioPercent: "12", fiscalYearEnd: "2026-03-31", submitDate: "2026-06-26", docId: "X" },
        "1234": { ratioPercent: 150, fiscalYearEnd: "2026-03-31", submitDate: "2026-06-26", docId: "X" },
      },
    });
    expect(f?.scannedThrough).toBe("2026-10-02");
    expect(Object.keys(f?.items ?? {})).toEqual(["8041"]);
    expect(f?.items["8041"]).toEqual(item);
  });
  it("前期が当期以降なら前期を捨てる", () => {
    const f = parseForeignFile({
      generatedAt: "x",
      scannedThrough: "",
      items: { "8041": { ...item, prevFiscalYearEnd: "2026-03-31" } },
    });
    expect(f?.items["8041"].prevRatioPercent).toBeUndefined();
  });
  it("形が違えば null", () => {
    expect(parseForeignFile(null)).toBeNull();
    expect(parseForeignFile({ generatedAt: "x", items: {} })).toBeNull();
    expect(parseForeignFile({ generatedAt: "x", scannedThrough: "2026/10/02", items: {} })).toBeNull();
    expect(parseForeignFile({ generatedAt: "x", scannedThrough: "", items: [] })).toBeNull();
  });
});

describe("buildForeignFile / sameForeignContent", () => {
  it("コード順に並べ、生成時刻だけの違いは同じとみなす", () => {
    const a = buildForeignFile({ "9999": item, "8041": item }, "2026-10-02", new Date("2026-10-03T00:00:00Z"));
    expect(Object.keys(a.items)).toEqual(["8041", "9999"]);
    const b = buildForeignFile({ "8041": item, "9999": item }, "2026-10-02", new Date("2026-10-04T00:00:00Z"));
    expect(sameForeignContent(a, b)).toBe(true);
    expect(sameForeignContent(a, { ...b, scannedThrough: "2026-10-03" })).toBe(false);
    expect(sameForeignContent(null, b)).toBe(false);
  });
});

describe("isForeignStale / freshForeignItem", () => {
  it("提出日から 18 か月を超えたら古い", () => {
    expect(isForeignStale("2025-04-03", "2026-10-03")).toBe(false);
    expect(isForeignStale("2025-04-02", "2026-10-03")).toBe(true);
    expect(isForeignStale("2026-06-26", "2026-10-03")).toBe(false);
    expect(isForeignStale("bad", "2026-10-03")).toBe(true);
  });
  it("古ければ undefined（不明扱い）", () => {
    expect(freshForeignItem(item, "2026-10-03")).toBe(item);
    expect(freshForeignItem(item, "2028-01-01")).toBeUndefined();
    expect(freshForeignItem(null, "2026-10-03")).toBeUndefined();
  });
});
