import { describe, expect, it } from "vitest";
import {
  classifyPurpose,
  holdingFilingPoints,
  HOLDINGS_POINTS,
  isListingTimeReport,
  pickHoldings,
  scoreHoldingFiling,
  summarizeHoldings,
} from "./score";
import { HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "./types";

const TODAY = "2026-09-30";

function item(p: Partial<HoldingItem> = {}): HoldingItem {
  return {
    code: "9999",
    name: "テスト",
    docId: "S100TEST",
    submitDate: TODAY,
    filer: "テスト株式会社",
    formType: "change",
    ratio: 0.1,
    prevRatio: 0.1,
    delta: 0,
    purpose: "純投資",
    shares: 1000,
    reason: "",
    obligationDate: "2026-09-25",
    listingDate: "2025-03-01",
    ...p,
  };
}

function file(items: HoldingItem[], coveredThrough = "2026-09-29"): HoldingsFile {
  return { generatedAt: "", coveredFrom: "2026-04-03", coveredThrough, source: HOLDINGS_SOURCE_TEXT, items };
}

describe("classifyPurpose", () => {
  it("提携・経営参加・重要提案を読み取る", () => {
    expect(classifyPurpose("発行者との資本業務提携を目的とした保有")).toEqual({ alliance: true, control: false, activist: false, pureInvestment: false });
    expect(classifyPurpose("発行会社の代表取締役社長として経営に参画するとともに")).toMatchObject({ control: true });
    expect(classifyPurpose("発行会社の子会社化を目的とする")).toMatchObject({ control: true });
    expect(classifyPurpose("純投資及び状況に応じて重要提案行為等を行うこと")).toMatchObject({ activist: true });
    expect(classifyPurpose("純投資")).toEqual({ alliance: false, control: false, activist: false, pureInvestment: true });
    expect(classifyPurpose("投資収益の獲得を目的とした保有").pureInvestment).toBe(true);
    expect(classifyPurpose("政策投資").pureInvestment).toBe(false);
  });

  it("「〜は行わない」のような打ち消しは数えない", () => {
    expect(classifyPurpose("純投資。重要提案行為等を行うことは予定していない").activist).toBe(false);
    expect(classifyPurpose("業務提携の予定はない").alliance).toBe(false);
  });

  it("重要提案行為等の欄に記載があれば activist", () => {
    expect(classifyPurpose("純投資", true).activist).toBe(true);
  });

  it("全角・半角の違いを吸収する", () => {
    expect(classifyPurpose("ＳＢＩとの業務提携").alliance).toBe(true);
  });
});

describe("isListingTimeReport", () => {
  it("大量保有報告書で、報告義務発生日が上場日の前日〜14 日後なら上場に伴う報告", () => {
    const base = { formType: "new" as const, listingDate: "2026-09-18" };
    expect(isListingTimeReport(item({ ...base, obligationDate: "2026-09-18" }))).toBe(true);
    expect(isListingTimeReport(item({ ...base, obligationDate: "2026-09-17" }))).toBe(true);
    expect(isListingTimeReport(item({ ...base, obligationDate: "2026-10-02" }))).toBe(true);
    expect(isListingTimeReport(item({ ...base, obligationDate: "2026-10-03" }))).toBe(false);
    expect(isListingTimeReport(item({ ...base, obligationDate: "2026-09-16" }))).toBe(false);
  });

  it("変更報告書・上場日不明は対象外。報告義務発生日が無ければ提出日で見る", () => {
    expect(isListingTimeReport(item({ formType: "change", listingDate: "2026-09-18", obligationDate: "2026-09-18" }))).toBe(false);
    expect(isListingTimeReport(item({ formType: "new", listingDate: undefined, obligationDate: "2026-09-18" }))).toBe(false);
    expect(isListingTimeReport(item({ formType: "new", listingDate: "2026-09-18", obligationDate: "", submitDate: "2026-09-25" }))).toBe(true);
  });
});

describe("holdingFilingPoints", () => {
  it("新規 5% 超: +40 と 5% を超えた分（最大 +15）、提携の目的で +20", () => {
    const r = holdingFilingPoints(
      item({ formType: "new", ratio: 0.1638, prevRatio: null, delta: null, purpose: "発行者との資本業務提携を目的とした保有" }),
    );
    expect(r.points).toBeCloseTo(40 + 11.38 + 20, 6);
    expect(r.signals.map((s) => s.label)).toEqual(["新規 16.4%", "事業提携"]);
    // 割合が大きくても上乗せは 15 まで
    expect(holdingFilingPoints(item({ formType: "new", ratio: 0.6, prevRatio: null, delta: null })).points).toBe(55);
  });

  it("上場に伴う報告は 0 点（保有目的の加点もしない）", () => {
    const r = holdingFilingPoints(
      item({ formType: "new", ratio: 0.6676, prevRatio: null, delta: null, purpose: "経営に参画", listingDate: "2026-09-18", obligationDate: "2026-09-18" }),
    );
    expect(r.points).toBe(0);
    expect(r.signals).toEqual([{ kind: "listing", label: "上場時の報告" }]);
  });

  it("買い増し: +1pt ちょうどで +20、1pt を超えた分 1pt ごとに +5（最大 +20）", () => {
    expect(holdingFilingPoints(item({ ratio: 0.11, prevRatio: 0.1, delta: 0.01 })).points).toBeCloseTo(20, 6);
    expect(holdingFilingPoints(item({ ratio: 0.13, prevRatio: 0.1, delta: 0.03 })).points).toBeCloseTo(30, 6);
    expect(holdingFilingPoints(item({ ratio: 0.3, prevRatio: 0.1, delta: 0.2 })).points).toBeCloseTo(40, 6);
    expect(holdingFilingPoints(item({ ratio: 0.13, prevRatio: 0.1, delta: 0.03 })).signals[0].label).toBe("買い増し +3.0pt");
  });

  it("1pt 未満の変更（契約・目的の変更など）は 0 点", () => {
    const r = holdingFilingPoints(item({ ratio: 0.1604, prevRatio: 0.1646, delta: -0.0042 }));
    expect(r.points).toBe(0);
    expect(r.signals).toEqual([]);
  });

  it("減少: −1pt で −20、超えた分 1pt ごとに −5（最大 −40）。提携の目的でも加点しない", () => {
    expect(holdingFilingPoints(item({ ratio: 0.09, prevRatio: 0.1, delta: -0.01, purpose: "業務提携" })).points).toBeCloseTo(-20, 6);
    expect(holdingFilingPoints(item({ ratio: 0.2, prevRatio: 0.3, delta: -0.1 })).points).toBeCloseTo(-40, 6);
  });

  it("5% 割れは −50（減少の点より小さい方）", () => {
    const r = holdingFilingPoints(item({ ratio: 0.045, prevRatio: 0.062, delta: -0.017 }));
    expect(r.points).toBe(HOLDINGS_POINTS.below5);
    expect(r.signals.map((s) => s.kind)).toEqual(["decrease", "below5"]);
    // 前回割合が無い変更報告書でも、5% 未満なら 5% 割れとみなす
    expect(holdingFilingPoints(item({ ratio: 0.03, prevRatio: null, delta: null })).points).toBe(-50);
  });

  it("短期大量譲渡は −40 以下", () => {
    const r = holdingFilingPoints(item({ formType: "bulkTransfer", ratio: 0.08, prevRatio: 0.1, delta: -0.02 }));
    expect(r.points).toBe(-40);
    expect(r.signals.map((s) => s.label)).toContain("短期大量譲渡");
    // 5% 割れと重なれば −50
    expect(holdingFilingPoints(item({ formType: "bulkTransfer", ratio: 0.0043, prevRatio: null, delta: null })).points).toBe(-50);
  });

  it("特例対象は半分", () => {
    expect(holdingFilingPoints(item({ formType: "newSpecial", ratio: 0.05, prevRatio: null, delta: null })).points).toBe(20);
    expect(holdingFilingPoints(item({ formType: "changeSpecial", ratio: 0.09, prevRatio: 0.1, delta: -0.01 })).points).toBe(-10);
  });

  it("公開買付の記載は点を変えずに理由に出す", () => {
    const r = holdingFilingPoints(item({ purpose: "公開買付に応募する予定" }));
    expect(r.points).toBe(0);
    expect(r.signals).toEqual([{ kind: "tenderOffer", label: "公開買付の記載" }]);
  });
});

describe("scoreHoldingFiling", () => {
  it("30 日で半分に減衰し、90 日より前は数えない", () => {
    expect(scoreHoldingFiling(item({ submitDate: TODAY }), TODAY)?.weight).toBe(1);
    expect(scoreHoldingFiling(item({ submitDate: "2026-08-31" }), TODAY)?.weight).toBeCloseTo(0.5, 10);
    expect(scoreHoldingFiling(item({ submitDate: "2026-07-02" }), TODAY)).not.toBeNull(); // 90 日
    expect(scoreHoldingFiling(item({ submitDate: "2026-07-01" }), TODAY)).toBeNull(); // 91 日
  });

  it("未来の提出日は経過 0 日として扱う", () => {
    expect(scoreHoldingFiling(item({ submitDate: "2026-10-05" }), TODAY)).toMatchObject({ weight: 1, elapsedDays: 0 });
  });
});

describe("summarizeHoldings / pickHoldings", () => {
  const items = [
    // A: 事業会社が新規 12%（提携）→ 注目
    item({ code: "A001", name: "エー", docId: "S1000001", formType: "new", ratio: 0.12, prevRatio: null, delta: null, purpose: "資本業務提携", submitDate: "2026-09-28" }),
    // B: VC が 5% 割れ → 注意
    item({ code: "B001", name: "ビー", docId: "S1000002", ratio: 0.041, prevRatio: 0.066, delta: -0.025, submitDate: "2026-09-25" }),
    item({ code: "B001", name: "ビー", docId: "S1000003", ratio: 0.066, prevRatio: 0.085, delta: -0.019, submitDate: "2026-08-20" }),
    // C: 上場時の報告だけ → 0 点（どちらにも入らない）
    item({ code: "C001", name: "シー", docId: "S1000004", formType: "new", ratio: 0.4, prevRatio: null, delta: null, listingDate: "2026-09-18", obligationDate: "2026-09-18", submitDate: "2026-09-25" }),
    // D: 買い増し +2pt が 60 日前 → 減衰して +6.25 → 中立
    item({ code: "D001", name: "ディー", docId: "S1000005", ratio: 0.12, prevRatio: 0.1, delta: 0.02, submitDate: "2026-08-01" }),
    // E: 100 日前の新規 → 期間外
    item({ code: "E001", name: "イー", docId: "S1000006", formType: "new", ratio: 0.2, prevRatio: null, delta: null, submitDate: "2026-06-22" }),
  ];

  it("銘柄ごとに足し、注目度の高い順に並べる", () => {
    const all = summarizeHoldings(items, TODAY);
    expect(all.map((p) => p.code)).toEqual(["A001", "D001", "C001", "B001"]);
    const a = all[0];
    // (40 + 7 + 20) × 0.5^(2/30)
    expect(a.score).toBe(Math.round(67 * Math.pow(0.5, 2 / 30)));
    expect(a.tone).toBe("positive");
    expect(a.reasons).toEqual(["新規 12.0%", "事業提携"]);
    expect(a.latest.docId).toBe("S1000001");
    const b = all.find((p) => p.code === "B001")!;
    expect(b.tone).toBe("caution");
    expect(b.filings.map((f) => f.item.docId)).toEqual(["S1000002", "S1000003"]);
    expect(b.reasons[0]).toBe("減少 −2.5pt");
    expect(b.reasons).toContain("5%割れ");
    expect(all.find((p) => p.code === "C001")).toMatchObject({ score: 0, tone: "neutral", reasons: ["上場時の報告"] });
    expect(all.find((p) => p.code === "D001")?.tone).toBe("neutral");
  });

  it("注目度は −100〜+100 に収める", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      item({ code: "Z001", docId: `S10000Z${i}`, formType: "new", ratio: 0.3, prevRatio: null, delta: null, purpose: "資本業務提携" }),
    );
    expect(summarizeHoldings(many, TODAY)[0].score).toBe(100);
  });

  it("pickHoldings は注目と注意に分け、出典を付ける", () => {
    const r = pickHoldings(file(items), TODAY);
    expect(r.picks.map((p) => p.code)).toEqual(["A001"]);
    expect(r.cautions.map((p) => p.code)).toEqual(["B001"]);
    expect(r.stale).toBe(false);
    expect(r.coveredThrough).toBe("2026-09-29");
    expect(r.source).toBe(HOLDINGS_SOURCE_TEXT);
    expect(pickHoldings(file(items), TODAY, { limit: 0 }).picks).toEqual([]);
  });

  it("null・空・古いデータでも落ちない", () => {
    expect(pickHoldings(null, TODAY)).toMatchObject({ picks: [], cautions: [], stale: true, coveredThrough: "" });
    expect(pickHoldings(file([], ""), TODAY)).toMatchObject({ picks: [], cautions: [], stale: true });
    const old = pickHoldings(file(items, "2026-09-01"), TODAY);
    expect(old.stale).toBe(true);
    expect(old.picks.map((p) => p.code)).toEqual(["A001"]);
  });
});
