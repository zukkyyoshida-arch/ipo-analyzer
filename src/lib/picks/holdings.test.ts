import { describe, expect, it } from "vitest";
import { HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "@/lib/holdings/types";
import {
  holdingRatioText,
  holdingsMethodLabel,
  isHoldingsMethodTarget,
  pickHoldingsMethod,
} from "./holdings";

const TODAY = "2026-09-30";

function item(p: Partial<HoldingItem> = {}): HoldingItem {
  return {
    code: "9999",
    name: "テスト",
    docId: "S100TEST",
    submitDate: TODAY,
    filer: "テスト投資顧問",
    formType: "change",
    ratio: 0.08,
    prevRatio: 0.06,
    delta: 0.02,
    purpose: "政策投資",
    shares: 1000,
    reason: "",
    obligationDate: "2026-09-25",
    listingDate: "2025-03-01",
    ...p,
  };
}

function file(items: HoldingItem[], coveredThrough = TODAY): HoldingsFile {
  return { generatedAt: "", coveredFrom: "2026-04-03", coveredThrough, source: HOLDINGS_SOURCE_TEXT, items };
}

describe("isHoldingsMethodTarget", () => {
  it("新規 5% 超と増加だけを対象にする", () => {
    expect(isHoldingsMethodTarget(item({ formType: "new", ratio: 0.064, prevRatio: null, delta: null }))).toBe(true);
    expect(isHoldingsMethodTarget(item({ delta: 0.004 }))).toBe(true);
    expect(isHoldingsMethodTarget(item({ delta: -0.02 }))).toBe(false);
    expect(isHoldingsMethodTarget(item({ delta: 0 }))).toBe(false);
    expect(isHoldingsMethodTarget(item({ delta: null }))).toBe(false);
    expect(isHoldingsMethodTarget(item({ formType: "bulkTransfer", delta: 0.02 }))).toBe(false);
  });

  it("上場に伴う報告は新しい買いではないので対象外", () => {
    expect(
      isHoldingsMethodTarget(
        item({ formType: "new", ratio: 0.3, prevRatio: null, delta: null, listingDate: "2026-09-24", obligationDate: "2026-09-24" }),
      ),
    ).toBe(false);
  });
});

describe("holdingsMethodLabel", () => {
  it("新規・買い増し・特例のラベルを返し、対象外は null", () => {
    expect(holdingsMethodLabel(item({ formType: "new", ratio: 0.064, prevRatio: null, delta: null }))).toBe("新規");
    expect(holdingsMethodLabel(item())).toBe("買い増し");
    expect(holdingsMethodLabel(item({ formType: "changeSpecial" }))).toBe("買い増し（特例）");
    expect(holdingsMethodLabel(item({ formType: "newSpecial", ratio: 0.06, prevRatio: null, delta: null }))).toBe("新規（特例）");
    expect(holdingsMethodLabel(item({ delta: -0.03 }))).toBeNull();
  });
});

describe("pickHoldingsMethod", () => {
  const items = [
    item({ code: "1111", name: "新規", docId: "A", formType: "new", ratio: 0.12, prevRatio: null, delta: null, purpose: "純投資" }),
    item({ code: "2222", name: "増加", docId: "B", submitDate: "2026-09-28" }),
    item({ code: "3333", name: "減少", docId: "C", delta: -0.02 }),
    item({ code: "4444", name: "古い", docId: "D", submitDate: "2026-09-23" }),
  ];

  it("今日: JST の今日の提出だけ", () => {
    const r = pickHoldingsMethod(file(items), TODAY, "today");
    expect(r.picks.map((p) => p.code)).toEqual(["1111"]);
    expect(r.from).toBe(TODAY);
    expect(r.source).toBe(HOLDINGS_SOURCE_TEXT);
  });

  it("直近 1 週間: 今日を含む 7 日。減少は出さない。提出日の新しい順でラベルを付ける", () => {
    const r = pickHoldingsMethod(file(items), TODAY, "week");
    expect(r.from).toBe("2026-09-24");
    expect(r.picks.map((p) => [p.code, p.label])).toEqual([
      ["1111", "新規"],
      ["2222", "買い増し"],
    ]);
    expect(r.picks[0].latest.filer).toBe("テスト投資顧問");
  });

  it("提出日が新しい方が上。同じ日ならコード昇順", () => {
    const r = pickHoldingsMethod(
      file([
        item({ code: "5555", docId: "E", submitDate: "2026-09-25" }),
        item({ code: "6666", docId: "F", submitDate: "2026-09-29" }),
        item({ code: "4444", docId: "H", submitDate: "2026-09-29" }),
      ]),
      TODAY,
      "week",
    );
    expect(r.picks.map((p) => p.code)).toEqual(["4444", "6666", "5555"]);
  });

  it("同じ銘柄の複数の提出は 1 行にまとめ、最新を代表にする", () => {
    const r = pickHoldingsMethod(
      file([
        item({ code: "7777", docId: "G1", submitDate: "2026-09-27", filer: "古い提出者" }),
        item({ code: "7777", docId: "G2", submitDate: "2026-09-29", filer: "新しい提出者" }),
      ]),
      TODAY,
      "week",
    );
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0].latest.filer).toBe("新しい提出者");
    expect(r.picks[0].filings).toHaveLength(2);
  });

  it("file が null でも落ちず、stale を返す", () => {
    const r = pickHoldingsMethod(null, TODAY, "week");
    expect(r.picks).toEqual([]);
    expect(r.stale).toBe(true);
  });
});

describe("holdingRatioText", () => {
  it("前回があれば前回 → 今回", () => {
    expect(holdingRatioText(item({ ratio: 0.0712, prevRatio: 0.0501 }))).toBe("5.0% → 7.1%");
    expect(holdingRatioText(item({ ratio: 0.164, prevRatio: null }))).toBe("16.4%");
    expect(holdingRatioText(item({ ratio: null }))).toBe("—");
  });
});
