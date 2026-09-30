import { describe, expect, it } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { HistoricalIpo } from "@/types/history";
import type { ScoreSettings } from "@/lib/scoring/types";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weights";
import { scoreBbParticipation, type BbScoreResult } from "@/lib/scoring/bb";
import { buildBbInputs } from "@/lib/scoring/bbInputs";
import { combineOutcomeSources } from "@/lib/stats/history";
import {
  bbPickPhase,
  bbPickPool,
  bbPickReasons,
  buildBbPickInputs,
  countBbOpen,
  rankBbPicks,
  type BbPickInput,
} from "./bb";

const TODAY = "2026-09-30";

function baseIpo(overrides: Partial<Ipo> = {}): Ipo {
  return {
    code: "TEST",
    name: "テスト銘柄",
    market: "グロース",
    sector: "情報・通信",
    theme: ["その他"],
    description: "",
    listingDate: "2026-10-15",
    bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
    allotmentDate: "",
    purchasePeriod: { start: "", end: "" },
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    absorptionAmount: 20,
    offeringRatio: 20,
    marketCap: 100,
    vcRatio: 20,
    lockup: { days: 180, hasPriceRelease: false, coverage: 60 },
    leadUnderwriter: "SBI証券",
    underwriters: ["SBI証券", "みずほ証券", "楽天証券"],
    financials: { revenue: 2000, revenueGrowth: 20, operatingProfit: 200, isProfitable: true },
    per: 30,
    psr: 4,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: null,
    status: "upcoming",
    similarIpoCodes: [],
    ...overrides,
  };
}

/** 上場済み（直近 IPO の初値動向の母数）。 */
function listed(code: string, listingDate: string, initialPrice: number): Ipo {
  return baseIpo({
    code,
    listingDate,
    bbPeriod: { start: "", end: "" },
    status: "listed",
    offeringPrice: 1000,
    initialPrice,
  });
}

function history(code: string, listingDate: string, initialPrice: number, lead = "SBI証券"): HistoricalIpo {
  return {
    code,
    name: `履歴${code}`,
    market: "グロース",
    listingDate,
    offeringPrice: 1000,
    initialPrice,
    assumedPrice: 1000,
    priceRange: { low: 950, high: 1050 },
    absorptionAmount: 20,
    marketCap: 100,
    offeringRatio: 20,
    saleRatio: 30,
    publicShares: 500000,
    saleShares: 300000,
    overAllotment: 100000,
    leadUnderwriter: lead,
    underwriterCount: 5,
    vcRatio: 10,
    lockupDays: 90,
    lockupHasPriceRelease: true,
    lockupCoverage: 50,
    revenueGrowth: 10,
    isProfitable: true,
    sourceUrl: "https://example.com",
    fetchedAt: "2026-01-01",
  };
}

const SETTINGS: ScoreSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentiment: "neutral",
  underwriterCoefficients: {},
};

describe("bbPickPhase（受付状況）", () => {
  it("BB 期間の両端が分かるときは日付で決める（両端の日を含む）", () => {
    const ipo = baseIpo({ bbPeriod: { start: "2026-10-01", end: "2026-10-07" } });
    expect(bbPickPhase(ipo, "2026-09-30")).toBe("before");
    expect(bbPickPhase(ipo, "2026-10-01")).toBe("open");
    expect(bbPickPhase(ipo, "2026-10-07")).toBe("open");
    expect(bbPickPhase(ipo, "2026-10-08")).toBeNull();
  });

  it("上場済みは対象外", () => {
    expect(bbPickPhase(baseIpo({ status: "listed" }), TODAY)).toBeNull();
  });

  it("日程が分からないときは status が bb_open なら受付中、開始日が先なら受付前、それ以外は対象外", () => {
    expect(bbPickPhase(baseIpo({ bbPeriod: { start: "", end: "" }, status: "bb_open" }), TODAY)).toBe("open");
    expect(bbPickPhase(baseIpo({ bbPeriod: { start: "", end: "" } }), TODAY)).toBeNull();
    expect(bbPickPhase(baseIpo({ bbPeriod: { start: "2026-10-05", end: "" } }), TODAY)).toBe("before");
    expect(bbPickPhase(baseIpo({ bbPeriod: { start: "2026-09-20", end: "" } }), TODAY)).toBeNull();
  });
});

describe("bbPickPool（対象）", () => {
  it("受付中・受付前だけを残し、公開価格も吸収金額も分からない銘柄は除く", () => {
    const pool = bbPickPool(
      [
        baseIpo({ code: "OPEN" }),
        baseIpo({ code: "BEFORE", bbPeriod: { start: "2026-10-05", end: "2026-10-09" } }),
        baseIpo({ code: "ENDED", bbPeriod: { start: "2026-09-20", end: "2026-09-25" }, status: "priced" }),
        baseIpo({ code: "EMPTY", absorptionAmount: 0, offeringPrice: null }),
        listed("LIST", "2026-09-01", 1500),
      ],
      TODAY,
    );
    expect(pool.map((p) => [p.ipo.code, p.phase])).toEqual([
      ["OPEN", "open"],
      ["BEFORE", "before"],
    ]);
  });
});

describe("buildBbPickInputs（サーバーで作る材料）", () => {
  const prior = [
    listed("P1", "2026-08-01", 1500),
    listed("P2", "2026-08-08", 1200),
    listed("P3", "2026-08-15", 900),
    listed("P4", "2026-08-22", 1800),
    listed("P5", "2026-09-01", 1100),
  ];
  const hist = [
    history("H1", "2024-03-01", 900),
    history("H2", "2024-06-01", 1300),
    history("H3", "2025-01-10", 800),
    history("H4", "2025-05-10", 1500),
    history("H5", "2023-10-01", 950),
    // 3年より前（2023-09-30 より前）は主幹事の実績に入れない
    history("OLD", "2020-01-10", 500),
  ];

  it("対象が無ければ空（履歴も使わない）", () => {
    expect(buildBbPickInputs(prior, hist, TODAY)).toEqual([]);
  });

  it("銘柄詳細と同じ buildBbInputs の値（主幹事の実績・文脈・公募割れ確率）を持つ", () => {
    const target = baseIpo({ code: "NEW" });
    const ipos = [...prior, target];
    const inputs = buildBbPickInputs(ipos, hist, TODAY);
    expect(inputs).toHaveLength(1);
    const expected = buildBbInputs(target, ipos, combineOutcomeSources(ipos, hist), TODAY);
    expect(inputs[0]).toEqual({
      code: "NEW",
      phase: "open",
      underwriterStat: expected.underwriterStat,
      context: expected.bbContext,
      breakEvenProbability: expected.breakEvenProbability?.probability ?? null,
    });
    // 主幹事（SBI証券）の実績は直近3年: 現行の上場済み5件＋履歴5件（OLD は入らない）
    expect(inputs[0].underwriterStat?.sampleCount).toBe(10);
    // 直近5件の初値騰落率平均（+50, +20, −10, +80, +10 → +30）
    expect(inputs[0].context.recentIpoAvgReturn).toBeCloseTo(30, 5);
    expect(inputs[0].breakEvenProbability).not.toBeNull();
    expect(inputs[0].breakEvenProbability).toBeGreaterThan(0);
    expect(inputs[0].breakEvenProbability).toBeLessThan(1);
  });

  it("受付中の数を数える", () => {
    expect(countBbOpen([{ phase: "open" }, { phase: "before" }, { phase: "open" }])).toBe(2);
    expect(countBbOpen([])).toBe(0);
  });
});

describe("bbPickReasons（行に出す理由）", () => {
  function result(items: { key: string; points: number; weight: number; rawText: string }[]): BbScoreResult {
    return {
      score: 50,
      items: items.map((i) => ({
        key: i.key as BbScoreResult["items"][number]["key"],
        label: i.key,
        points: i.points,
        weight: i.weight,
        contribution: i.points * i.weight,
        rawText: i.rawText,
        reason: "",
      })),
    };
  }

  it("影響の大きい順に3件まで。地合い・0点は出さず、加点→減点の順に並べる", () => {
    const reasons = bbPickReasons(
      result([
        { key: "absorption", points: -1, weight: 4, rawText: "120億円" },
        { key: "offeringRatioBb", points: 2, weight: 4, rawText: "8%" },
        { key: "underwriterTrack", points: 0, weight: 2, rawText: "公募割れ率12%（母数9件）" },
        { key: "priceRangePosition", points: 0, weight: 3, rawText: "未取得" },
        { key: "vcLockup", points: 2, weight: 2, rawText: "VC 0% / ロック180日" },
        { key: "sentiment", points: 2, weight: 2, rawText: "強い" },
        { key: "saleRatio", points: -2, weight: 2, rawText: "85%" },
        { key: "recentIpoSentiment", points: 1, weight: 2, rawText: "直近5件平均 +90%" },
      ]),
      null,
      { recentIpoAvgReturn: 90 },
    );
    // |影響|: OR 8, 吸収 4, VC 4, 売出 4, 直近 2 → 上位3件は OR・VC（加点が先）・吸収
    expect(reasons.map((r) => [r.key, r.tone, r.text])).toEqual([
      ["offeringRatioBb", "good", "オファリングレシオ 8%"],
      ["vcLockup", "good", "VC 0% / ロック180日"],
      ["absorption", "bad", "吸収金額 120億円"],
    ]);
  });

  it("主幹事・仮条件・直近 IPO は短い言い方にする", () => {
    const reasons = bbPickReasons(
      result([
        { key: "underwriterTrack", points: -2, weight: 2, rawText: "公募割れ率35%（母数20件）" },
        { key: "priceRangePosition", points: 2, weight: 3, rawText: "想定1,000円 / 仮条件1,100〜1,200円" },
        { key: "recentIpoSentiment", points: -1, weight: 2, rawText: "直近5件平均 +40.1%" },
      ]),
      { underwriter: "X証券", sampleCount: 20, breakEvenRate: 35.04, meanReturn: 10, lowSample: false },
      { recentIpoAvgReturn: 40.12 },
    );
    expect(reasons.map((r) => r.text)).toEqual([
      "仮条件が想定価格より上",
      "主幹事の公募割れ率 35%",
      "直近IPOの初値 平均+40.1%",
    ]);
  });
});

describe("rankBbPicks（クライアントで並べる）", () => {
  // A: 吸収金額・OR・売出比率が小さい（高スコア）、B: どれも大きい（低スコア）
  const a = baseIpo({ code: "A", absorptionAmount: 5, offeringRatio: 8, saleShares: 0, listingDate: "2026-10-20" });
  const b = baseIpo({
    code: "B",
    absorptionAmount: 600,
    offeringRatio: 60,
    saleShares: 2000000,
    listingDate: "2026-10-10",
  });
  const c = baseIpo({ code: "C", listingDate: "2026-10-12", bbPeriod: { start: "2026-10-05", end: "2026-10-09" } });
  const input = (code: string, phase: BbPickInput["phase"], p: number | null = null): BbPickInput => ({
    code,
    phase,
    underwriterStat: null,
    context: {},
    breakEvenProbability: p,
  });

  it("BB 参加スコアの高い順。スコアは scoreBbParticipation と同じ", () => {
    const picks = rankBbPicks([a, b, c], [input("B", "open", 0.4), input("A", "open", 0.05), input("C", "before")], SETTINGS);
    expect(picks.map((p) => p.ipo.code)).toEqual(["A", "C", "B"]);
    expect(picks[0].bbScore).toBe(scoreBbParticipation(a, SETTINGS, null, undefined, {}).score);
    expect(picks[0].breakEvenProbability).toBe(0.05);
    expect(picks[1].phase).toBe("before");
    expect(picks[2].reasons.every((r) => r.tone === "bad")).toBe(true);
  });

  it("同点は上場日の早い順", () => {
    const x = baseIpo({ code: "X", listingDate: "2026-10-20" });
    const y = baseIpo({ code: "Y", listingDate: "2026-10-10" });
    const picks = rankBbPicks([x, y], [input("X", "open"), input("Y", "open")], SETTINGS);
    expect(picks.map((p) => p.ipo.code)).toEqual(["Y", "X"]);
  });

  it("地合いの設定はスコアに入るが、全銘柄に同じ点なので並び順は変わらない", () => {
    const inputs = [input("B", "open"), input("A", "open"), input("C", "before")];
    const neutral = rankBbPicks([a, b, c], inputs, SETTINGS);
    const strong = rankBbPicks([a, b, c], inputs, { ...SETTINGS, sentiment: "strong" });
    expect(strong.map((p) => p.ipo.code)).toEqual(neutral.map((p) => p.ipo.code));
    expect(strong[0].bbScore).toBeGreaterThan(neutral[0].bbScore);
  });

  it("材料に対応する銘柄が無ければ飛ばす", () => {
    expect(rankBbPicks([a], [input("A", "open"), input("ZZZ", "open")], SETTINGS).map((p) => p.ipo.code)).toEqual([
      "A",
    ]);
  });
});
