import { describe, expect, it } from "vitest";
import bundledHoldings from "../../../public/data/holdings.json";
import {
  emptyHoldingsFile,
  formatHoldingDelta,
  formatHoldingRatio,
  holdingFormLabel,
  isHoldingsStale,
  parseHoldingsFile,
} from "./file";
import { pickHoldings } from "./score";
import { HOLDINGS_ATTRIBUTION, HOLDINGS_SOURCE_TEXT, type HoldingItem } from "./types";

const item: HoldingItem = {
  code: "623A",
  name: "ベルテックス",
  docId: "S100Z48K",
  submitDate: "2026-09-24",
  filer: "山田 太郎",
  formType: "new",
  ratio: 0.6676,
  prevRatio: null,
  delta: null,
  purpose: "経営に参画",
  shares: 7530000,
  reason: "",
  obligationDate: "2026-09-18",
  listingDate: "2026-09-18",
  amendedFrom: "S100Z0YQ",
};

describe("parseHoldingsFile", () => {
  it("正しい形はそのまま読む（出典は常に最新の定数）", () => {
    const f = parseHoldingsFile({
      generatedAt: "2026-09-30T02:00:00.000Z",
      coveredFrom: "2026-04-03",
      coveredThrough: "2026-09-29",
      source: "古い出典表記",
      items: [item],
    });
    expect(f).toEqual({
      generatedAt: "2026-09-30T02:00:00.000Z",
      coveredFrom: "2026-04-03",
      coveredThrough: "2026-09-29",
      source: HOLDINGS_SOURCE_TEXT,
      items: [item],
    });
  });

  it("オブジェクトでなければ null", () => {
    expect(parseHoldingsFile(null)).toBeNull();
    expect(parseHoldingsFile([])).toBeNull();
    expect(parseHoldingsFile("x")).toBeNull();
  });

  it("items が無い・壊れた日付でも空の形で読む", () => {
    expect(parseHoldingsFile({})).toEqual(emptyHoldingsFile());
    expect(parseHoldingsFile({ coveredThrough: "2026/09/29", items: "x" })).toMatchObject({ coveredThrough: "", items: [] });
  });

  it("形の崩れた行・重複した docID は落とし、欠けた任意項目は既定値で埋める（古い版の holdings.json）", () => {
    const f = parseHoldingsFile({
      coveredThrough: "2026-09-29",
      items: [
        { code: "4436", docId: "S100AAAA", submitDate: "2026-09-29", ratio: 0.1604, prevRatio: 0.1646, futureField: 1 },
        { code: "4436", docId: "S100AAAA", submitDate: "2026-09-28" },
        { code: "", docId: "S100BBBB", submitDate: "2026-09-29" },
        { code: "4436", docId: "S100CCCC", submitDate: "昨日" },
        { code: "4436", docId: "S100DDDD", submitDate: "2026-09-27", formType: "unknown", ratio: 5.2, holders: 1 },
        null,
      ],
    });
    expect(f?.items).toEqual([
      {
        code: "4436",
        name: "4436",
        docId: "S100AAAA",
        submitDate: "2026-09-29",
        filer: "",
        formType: "change",
        ratio: 0.1604,
        prevRatio: 0.1646,
        delta: -0.0042,
        purpose: "",
        shares: null,
        reason: "",
        obligationDate: "",
      },
      {
        code: "4436",
        name: "4436",
        docId: "S100DDDD",
        submitDate: "2026-09-27",
        filer: "",
        formType: "change",
        ratio: null,
        prevRatio: null,
        delta: null,
        purpose: "",
        shares: null,
        reason: "",
        obligationDate: "",
      },
    ]);
  });

  it("提出日の新しい順に並べ直す", () => {
    const f = parseHoldingsFile({
      items: [
        { ...item, docId: "S1", submitDate: "2026-09-01" },
        { ...item, docId: "S2", submitDate: "2026-09-20" },
      ],
    });
    expect(f?.items.map((i) => i.docId)).toEqual(["S2", "S1"]);
  });
});

describe("同梱の holdings.json", () => {
  it("読めて、選定まで落ちずに通る", () => {
    const f = parseHoldingsFile(bundledHoldings);
    expect(f).not.toBeNull();
    expect(f!.items.length).toBe((bundledHoldings as { items: unknown[] }).items.length);
    const picks = pickHoldings(f, f!.coveredThrough || "2026-09-30");
    expect(Array.isArray(picks.picks)).toBe(true);
    for (const p of [...picks.picks, ...picks.cautions]) {
      expect(p.score).toBeGreaterThanOrEqual(-100);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p.reasons.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("isHoldingsStale", () => {
  it("coveredThrough が 7 日より前・未取得なら古い", () => {
    expect(isHoldingsStale({ coveredThrough: "2026-09-29" }, "2026-09-30")).toBe(false);
    expect(isHoldingsStale({ coveredThrough: "2026-09-23" }, "2026-09-30")).toBe(false);
    expect(isHoldingsStale({ coveredThrough: "2026-09-22" }, "2026-09-30")).toBe(true);
    expect(isHoldingsStale({ coveredThrough: "" }, "2026-09-30")).toBe(true);
    expect(isHoldingsStale(null, "2026-09-30")).toBe(true);
  });
});

describe("表示の整形", () => {
  it("割合・増減・書類の種類", () => {
    expect(formatHoldingRatio(0.1638)).toBe("16.38%");
    expect(formatHoldingRatio(null)).toBe("—");
    expect(formatHoldingDelta(0.012)).toBe("+1.20pt");
    expect(formatHoldingDelta(-0.0042)).toBe("−0.42pt");
    expect(formatHoldingDelta(0)).toBe("±0.00pt");
    expect(formatHoldingDelta(null)).toBe("—");
    expect(holdingFormLabel("bulkTransfer")).toBe("変更報告書（短期大量譲渡）");
  });

  it("出典表記は PDL1.0 の記載例に沿い、加工したことと主体を書く", () => {
    expect(HOLDINGS_SOURCE_TEXT).toContain("出典：EDINET閲覧（提出）サイト（https://disclosure2.edinet-fsa.go.jp/）");
    expect(HOLDINGS_SOURCE_TEXT).toContain("PDL1.0（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）");
    expect(HOLDINGS_ATTRIBUTION.processedNote).toContain("カブレーダー が加工して作成");
  });
});
