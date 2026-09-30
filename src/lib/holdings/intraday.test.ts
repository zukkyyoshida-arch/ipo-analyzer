import { describe, expect, it } from "vitest";
import type { HoldingItem, HoldingsFile } from "@/lib/holdings/types";
import { HOLDINGS_SOURCE_TEXT } from "@/lib/holdings/types";
import {
  formatIntradayTime,
  intradayHoldingsKey,
  mergeIntradayHoldings,
  parseIntradayHoldings,
} from "@/lib/holdings/intraday";

function item(p: Partial<HoldingItem> & { docId: string; submitDate: string }): HoldingItem {
  return {
    code: "4436",
    name: "ミンカブ",
    filer: "提出者",
    formType: "change",
    ratio: 0.07,
    prevRatio: 0.06,
    delta: 0.01,
    purpose: "純投資",
    shares: 1000,
    reason: "",
    obligationDate: "",
    ...p,
  };
}

function file(p: Partial<HoldingsFile>): HoldingsFile {
  return {
    generatedAt: "2026-09-30T17:00:00.000Z",
    coveredFrom: "2026-04-04",
    coveredThrough: "2026-09-30",
    source: HOLDINGS_SOURCE_TEXT,
    items: [],
    ...p,
  };
}

const intraday = file({
  generatedAt: "2026-10-01T05:00:00.000Z",
  coveredFrom: "2026-10-01",
  coveredThrough: "2026-10-01",
  items: [
    item({ docId: "S100NEW1", submitDate: "2026-10-01" }),
    item({ docId: "S100FIX1", submitDate: "2026-09-29", amendedFrom: "S100OLD1" }),
  ],
});

describe("mergeIntradayHoldings", () => {
  it("前日まで取り終えた holdings.json に当日分を重ね、訂正前の書類を外す", () => {
    const nightly = file({
      items: [item({ docId: "S100OLD1", submitDate: "2026-09-29" }), item({ docId: "S100KEEP", submitDate: "2026-09-30" })],
    });
    const merged = mergeIntradayHoldings(nightly, intraday);
    expect(merged?.items.map((it) => it.docId)).toEqual(["S100NEW1", "S100KEEP", "S100FIX1"]);
    expect(merged?.coveredThrough).toBe("2026-10-01");
    expect(merged?.coveredFrom).toBe("2026-04-04");
    expect(merged?.intradayAt).toBe("2026-10-01T05:00:00.000Z");
  });

  it("holdings.json が既にその日を取り込んでいれば重ねない", () => {
    const nightly = file({ coveredThrough: "2026-10-01" });
    expect(mergeIntradayHoldings(nightly, intraday)).toBe(nightly);
  });

  it("同じ docID は holdings.json を正とする", () => {
    const nightly = file({ items: [item({ docId: "S100NEW1", submitDate: "2026-10-01", filer: "夜間" })] });
    const merged = mergeIntradayHoldings(nightly, intraday);
    expect(merged?.items.filter((it) => it.docId === "S100NEW1").map((it) => it.filer)).toEqual(["夜間"]);
  });

  it("夜間が止まっているときは coveredThrough を進めない（更新待ちを隠さない）", () => {
    const nightly = file({ coveredThrough: "2026-09-20" });
    const merged = mergeIntradayHoldings(nightly, intraday);
    expect(merged?.coveredThrough).toBe("2026-09-20");
    expect(merged?.items).toHaveLength(2);
  });

  it("日中分が無ければそのまま、holdings.json が無ければ日中分だけ", () => {
    const nightly = file({});
    expect(mergeIntradayHoldings(nightly, null)).toBe(nightly);
    expect(mergeIntradayHoldings(null, intraday)?.items).toHaveLength(2);
    expect(mergeIntradayHoldings(null, null)).toBeNull();
  });
});

describe("parseIntradayHoldings", () => {
  it("壊れた値・日付の無い値は null", () => {
    expect(parseIntradayHoldings(null)).toBeNull();
    expect(parseIntradayHoldings("{ broken")).toBeNull();
    expect(parseIntradayHoldings(JSON.stringify({ items: [] }))).toBeNull();
    expect(parseIntradayHoldings(JSON.stringify(intraday))?.items).toHaveLength(2);
  });
});

describe("intradayHoldingsKey / formatIntradayTime", () => {
  it("キーは日付ごと、時刻は JST", () => {
    expect(intradayHoldingsKey("2026-10-01")).toBe("intraday:2026-10-01");
    expect(formatIntradayTime("2026-10-01T05:00:00.000Z")).toBe("14:00");
    expect(formatIntradayTime("")).toBe("");
  });
});
