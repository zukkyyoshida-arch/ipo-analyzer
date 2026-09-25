import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { UnderwriterAllocation } from "@/types/enriched";
import { DEFAULT_BROKERS } from "@/data/brokers";
import {
  LOTTERY_TYPE_LABELS,
  isLeadBroker,
  isSameBrokerName,
  matchBrokerName,
  normalizeBrokerName,
  rankBrokersForIpo,
} from "./priority";

function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "",
    theme: [],
    description: "",
    listingDate: "2026-10-20",
    bbPeriod: { start: "2026-10-01", end: "2026-10-07" },
    allotmentDate: "2026-10-08",
    purchasePeriod: { start: "2026-10-09", end: "2026-10-15" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 0,
    saleShares: 0,
    overAllotment: 0,
    absorptionAmount: 10,
    offeringRatio: 20,
    marketCap: 50,
    vcRatio: 0,
    lockup: { days: 90, hasPriceRelease: true, coverage: 0 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券"],
    financials: { revenue: 0, revenueGrowth: 0, operatingProfit: 0, isProfitable: false },
    per: null,
    psr: null,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: null,
    status: "upcoming",
    similarIpoCodes: [],
    ...overrides,
  };
}

function broker(id: string, overrides: Partial<Broker> = {}): Broker {
  return {
    id,
    name: `${id}証券`,
    lotteryType: "equal",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 0,
    ...overrides,
  };
}

describe("normalizeBrokerName / matchBrokerName", () => {
  it("括弧以降・空白・「證/証」・「証券」有無・全角英字の揺れを吸収する", () => {
    expect(normalizeBrokerName("岡三証券（岡三オンライン）")).toBe("岡三");
    expect(normalizeBrokerName("野村證券")).toBe("野村");
    expect(normalizeBrokerName("ＳＢＩ 証券")).toBe("SBI");
    expect(isSameBrokerName("野村證券", "野村証券")).toBe(true);
    expect(isSameBrokerName("SMBC日興", "SMBC日興証券")).toBe(true);
    expect(isSameBrokerName("藍澤證券（アイザワ証券）", "藍澤証券")).toBe(true);
    expect(isSameBrokerName("", "")).toBe(false);
  });

  it("96ut の主要9社表記を DEFAULT_BROKERS に突合でき、別会社は一致しない", () => {
    const cases: [string, string | undefined][] = [
      ["岡三証券（岡三オンライン）", undefined],
      ["SBI証券", "sbi"],
      ["野村證券", "nomura"],
      ["大和証券", "daiwa"],
      ["みずほ証券", "mizuho"],
      ["SMBC日興証券", "smbc-nikko"],
      ["マネックス証券", "monex"],
      ["楽天証券", "rakuten"],
      ["松井証券", "matsui"],
      ["岡三にいがた証券", undefined],
      ["三菱UFJモルガン・スタンレー証券", undefined],
    ];
    for (const [name, id] of cases) {
      expect(matchBrokerName(name, DEFAULT_BROKERS)?.id).toBe(id);
    }
  });

  it("共同主幹事（・区切り）でも主幹事を判定できる", () => {
    const nikko = DEFAULT_BROKERS.find((b) => b.id === "smbc-nikko")!;
    const mizuho = DEFAULT_BROKERS.find((b) => b.id === "mizuho")!;
    const lead = "SMBC日興証券・三菱UFJモルガン・スタンレー証券";
    expect(isLeadBroker(nikko, lead)).toBe(true);
    expect(isLeadBroker(mizuho, lead)).toBe(false);
    expect(isLeadBroker(nikko, "")).toBe(false);
  });
});

describe("rankBrokersForIpo", () => {
  it("配分比率あり: 銘柄内の最大比率を100とした正規化値×抽選方式係数＋前受金なし+5 で算出", () => {
    const brokers = [
      broker("a", { lotteryType: "equal" }),
      broker("b", { lotteryType: "proportional", requiresDeposit: false }),
      broker("c", { lotteryType: "point" }),
    ];
    const allocations: UnderwriterAllocation[] = [
      { name: "a証券", shares: 900000, ratioPercent: 90 },
      { name: "b証券", shares: 50000, ratioPercent: 5 },
      { name: "c証券", shares: 20000, ratioPercent: 2 },
    ];
    const ipo = baseIpo({ leadUnderwriter: "a証券", underwriters: ["a証券", "b証券", "c証券"] });
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    expect(result.map((e) => e.broker.id)).toEqual(["a", "b", "c"]);
    expect(result[0].priorityScore).toBe(100); // 90/90×100×1.0
    expect(result[1].priorityScore).toBe(8.9); // 5/90×100×0.7+5 = 8.88…
    expect(result[2].priorityScore).toBe(2); // 2/90×100×0.9
    expect(result.every((e) => !e.allocationMissing)).toBe(true);
    expect(result[1].allocationRatioPercent).toBe(5);
    expect(result[1].reason).toBe(`幹事配分5%・${LOTTERY_TYPE_LABELS.proportional}・前受金なし`);
    expect(result[0].isLead).toBe(true);
  });

  it("配分なし: 主幹事60/幹事30 に係数を掛け、比率は null・理由に「幹事配分 未取得」", () => {
    const brokers = [
      broker("lead", { lotteryType: "stage" }),
      broker("mem", { lotteryType: "equal", requiresDeposit: false }),
    ];
    const ipo = baseIpo({ leadUnderwriter: "lead証券", underwriters: ["lead証券", "mem証券"] });
    const result = rankBrokersForIpo(ipo, brokers, undefined);
    expect(result.map((e) => [e.broker.id, e.priorityScore])).toEqual([
      ["lead", 48], // 60×0.8
      ["mem", 35], // 30×1.0+5
    ]);
    expect(result.every((e) => e.allocationRatioPercent === null)).toBe(true);
    expect(result.every((e) => !e.allocationMissing)).toBe(true);
    expect(result[1].reason).toBe("幹事配分 未取得・完全平等・前受金なし");
    // 空配列も未取得と同じ扱い
    expect(rankBrokersForIpo(ipo, brokers, [])).toEqual(result);
  });

  it("幹事団に含まれない証券会社は除外する", () => {
    const brokers = [broker("a"), broker("b"), broker("z")];
    const ipo = baseIpo({ leadUnderwriter: "a証券", underwriters: ["a証券"] });
    const allocations: UnderwriterAllocation[] = [
      { name: "a証券", shares: 1000, ratioPercent: 95 },
      { name: "b證券（別名）", shares: 50, ratioPercent: 5 },
    ];
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    expect(result.map((e) => e.broker.id)).toEqual(["a", "b"]);
    expect(result.every((e) => e.inSyndicate)).toBe(true);
    expect(rankBrokersForIpo(baseIpo({ leadUnderwriter: "", underwriters: [] }), brokers, undefined)).toEqual([]);
  });

  it("配分表に行があっても比率が null の証券会社はフォールバック点になる", () => {
    const brokers = [broker("a"), broker("b")];
    const ipo = baseIpo({ leadUnderwriter: "a証券", underwriters: ["a証券", "b証券"] });
    const allocations: UnderwriterAllocation[] = [
      { name: "a証券", shares: null, ratioPercent: null },
      { name: "b証券", shares: 100, ratioPercent: 1 },
    ];
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    // b は最大比率なので 100、a は主幹事フォールバック 60
    expect(result[0]).toMatchObject({ broker: { id: "b" }, priorityScore: 100, allocationRatioPercent: 1 });
    expect(result[1]).toMatchObject({
      broker: { id: "a" },
      priorityScore: 60,
      allocationRatioPercent: null,
      allocationMissing: false,
    });
  });

  it("同点は 主幹事 → 配分比率降順 → 名前順 で並ぶ", () => {
    // a・b・c は最大比率20%で100点（主幹事は b）。d(10%・完全平等) と e(12.5%・ステージ制) は50点で同点。
    const brokers = [broker("c"), broker("a"), broker("b"), broker("d"), broker("e", { lotteryType: "stage" })];
    const allocations: UnderwriterAllocation[] = [
      { name: "a証券", shares: 1, ratioPercent: 20 },
      { name: "b証券", shares: 1, ratioPercent: 20 },
      { name: "c証券", shares: 1, ratioPercent: 20 },
      { name: "d証券", shares: 1, ratioPercent: 10 },
      { name: "e証券", shares: 1, ratioPercent: 12.5 },
    ];
    const ipo = baseIpo({ leadUnderwriter: "b証券", underwriters: [] });
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    expect(result.map((e) => e.priorityScore)).toEqual([100, 100, 100, 50, 50]);
    expect(result.map((e) => e.broker.id)).toEqual(["b", "a", "c", "e", "d"]);
  });

  it("配分比率10%以上でも同点にならず、比率の差がそのまま順位に出る", () => {
    const brokers = [broker("a"), broker("b"), broker("c")];
    const allocations: UnderwriterAllocation[] = [
      { name: "a証券", shares: 1, ratioPercent: 60 },
      { name: "b証券", shares: 1, ratioPercent: 30 },
      { name: "c証券", shares: 1, ratioPercent: 10 },
    ];
    const ipo = baseIpo({ leadUnderwriter: "a証券", underwriters: [] });
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    expect(result.map((e) => [e.broker.id, e.priorityScore])).toEqual([
      ["a", 100],
      ["b", 50],
      ["c", 16.7],
    ]);
  });

  it("配分データがある銘柄で配分表と照合できない幹事は「幹事配分 未取得」として0点・末尾", () => {
    const brokers = [
      broker("lead", { requiresDeposit: false }),
      broker("x"),
      broker("y", { lotteryType: "proportional" }),
    ];
    // 主幹事 lead は配分表に無い（別表記などで名寄せできない）ケース
    const ipo = baseIpo({ leadUnderwriter: "lead証券", underwriters: ["lead証券", "x証券", "y証券"] });
    const allocations: UnderwriterAllocation[] = [
      { name: "x証券", shares: 100, ratioPercent: 4 },
      { name: "y証券", shares: 50, ratioPercent: 2 },
    ];
    const result = rankBrokersForIpo(ipo, brokers, allocations);
    expect(result.map((e) => e.broker.id)).toEqual(["x", "y", "lead"]);
    expect(result[0].priorityScore).toBe(100);
    expect(result[1].priorityScore).toBe(35); // 2/4×100×0.7
    expect(result[2]).toMatchObject({
      priorityScore: 0,
      allocationRatioPercent: null,
      allocationMissing: true,
      isLead: true,
    });
    expect(result[2].reason).toContain("幹事配分 未取得");
    // 配分データが無い銘柄では従来どおりフォールバック点（主幹事60＋前受金なし5）
    const fallback = rankBrokersForIpo(ipo, brokers, undefined);
    expect(fallback[0]).toMatchObject({ broker: { id: "lead" }, priorityScore: 65, allocationMissing: false });
  });

  it("実データ相当: 96ut 表記の配分で DEFAULT_BROKERS を並べると最大配分の主幹事が先頭", () => {
    const ipo = baseIpo({
      leadUnderwriter: "みずほ証券",
      underwriters: ["みずほ証券", "SMBC日興証券", "松井証券", "楽天証券"],
    });
    const allocations: UnderwriterAllocation[] = [
      { name: "みずほ証券", shares: 748000, ratioPercent: 93.5 },
      { name: "SMBC日興証券", shares: 16000, ratioPercent: 2 },
      { name: "三菱UFJモルガン・スタンレー証券", shares: 16000, ratioPercent: 2 },
      { name: "松井証券", shares: 8000, ratioPercent: 1 },
      { name: "楽天証券", shares: 8000, ratioPercent: 1 },
    ];
    const result = rankBrokersForIpo(ipo, DEFAULT_BROKERS, allocations);
    // みずほ 93.5/93.5×100×0.7=70、松井 1/93.5×100×1.0+5≈6.1、日興 2/93.5×100×0.8≈1.7、楽天 ≈1.1
    expect(result.map((e) => e.broker.id)).toEqual(["mizuho", "matsui", "smbc-nikko", "rakuten"]);
    expect(result.find((e) => e.broker.id === "mizuho")?.priorityScore).toBe(70);
    expect(result.find((e) => e.broker.id === "matsui")?.priorityScore).toBe(6.1);
    expect(result.find((e) => e.broker.id === "smbc-nikko")?.priorityScore).toBe(1.7);
    expect(result.find((e) => e.broker.id === "rakuten")?.priorityScore).toBe(1.1);
  });
});
