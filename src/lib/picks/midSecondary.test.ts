import { describe, expect, it } from "vitest";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import type { MidFile, MidItem } from "@/lib/midterm/file";
import type { FinsFile, FinsItem } from "@/types/fins";
import type { MarginFile } from "@/types/margin";
import { DEFAULT_THRESHOLDS } from "@/lib/checkpoints/thresholds";
import {
  checkEquityRatio,
  checkFounderTop,
  checkIndustry,
  checkMarginRatio,
  checkOperatingCf,
  checkProgress,
  classifyTopHolder,
  currentMarketCapOku,
  monthDayJa,
  runMidChecks,
  checkFirstEarningsGap,
  checkGrowth,
  checkLockupPassed,
  checkMarketCap,
  checkVolumeFloor,
  estimateNextEarnings,
  rankMidSecondary,
} from "./midSecondary";

const TODAY = "2026-09-30";

function item(overrides: Partial<MidItem> = {}): MidItem {
  return {
    code: "9999",
    name: "テスト",
    listingDate: "2025-12-01",
    bars: 200,
    lastDate: "2026-09-29",
    close: 400,
    ath: 1000,
    athDate: "2025-12-05",
    low: 350,
    lowDate: "2026-09-10",
    drawdown: -0.6,
    rebound: 400 / 350 - 1,
    avgVolume20: 150_000,
    hits: { "40": "2026-03-01", "50": "2026-05-01", "60": "2026-09-20" },
    ...overrides,
  };
}

const goodHistory = [
  { period: "2024年12月期", revenue: 1000, operatingProfit: 100, netProfit: 60, revenueChangePercent: null },
  { period: "2025年12月期", revenue: 1300, operatingProfit: 150, netProfit: 90, revenueChangePercent: 30 },
  { period: "2026年12月期（予想）", revenue: 1500, operatingProfit: 180, netProfit: 100, revenueChangePercent: 15 },
];

describe("チェック", () => {
  const ipo = makeIpo({ code: "9999", listingDate: "2025-12-01", lockup: { days: 180, hasPriceRelease: false, coverage: 60 } });

  it("出来高: 10 万株以上クリア・5 万株未満は警戒", () => {
    expect(checkVolumeFloor({ item: item(), todayIso: TODAY }).verdict).toBe("pass");
    expect(checkVolumeFloor({ item: item({ avgVolume20: 70_000 }), todayIso: TODAY }).verdict).toBe("warn");
    expect(checkVolumeFloor({ item: item({ avgVolume20: 30_000 }), todayIso: TODAY }).verdict).toBe("fail");
  });

  it("時価総額: 発行済 × 分割係数 × 終値。50 億未満は注意", () => {
    const small = checkMarketCap({ item: item(), ipo, enriched: { issuedShares: 5_000_000 }, todayIso: TODAY });
    expect(small.verdict).toBe("warn");
    expect(small.value).toBe("20億円");
    const big = checkMarketCap({ item: item(), ipo: { ...ipo, splitFactor: 3 }, enriched: { issuedShares: 5_000_000 }, todayIso: TODAY });
    expect(big.verdict).toBe("pass");
  });

  it("ロックアップ: 180 日経過でクリア、前なら残り日数", () => {
    expect(checkLockupPassed({ item: item(), ipo, todayIso: TODAY }, TODAY).verdict).toBe("pass");
    const young = checkLockupPassed({ item: item(), ipo: { ...ipo, listingDate: "2026-06-01" }, todayIso: TODAY }, TODAY);
    expect(young.verdict).toBe("warn");
    expect(young.short).toBe("ロック解除まで 59 日");
  });

  it("業績: 増収 10%・増益 20%・利益率 10% でクリア、減収は警戒（候補から外す）、無ければ不明", () => {
    expect(checkGrowth({ item: item(), enriched: { financialHistory: goodHistory }, todayIso: TODAY }).verdict).toBe("pass");
    const down = [goodHistory[0], { ...goodHistory[1], revenue: 900 }];
    const r = checkGrowth({ item: item(), enriched: { financialHistory: down }, todayIso: TODAY });
    expect(r.verdict).toBe("fail");
    expect(r.short).toBe("直近期 減収");
    expect(checkGrowth({ item: item(), todayIso: TODAY }).verdict).toBe("unknown");
  });

  it("決算: 既知の日が 28 日以内なら注意、無ければ決算期から推定", () => {
    const soon = checkFirstEarningsGap({ item: item(), ipo: { ...ipo, firstEarningsDate: "2026-10-10" }, todayIso: TODAY }, TODAY);
    expect(soon.verdict).toBe("warn");
    // 12 月期 → 9 月末の四半期の 45 日後 = 11/14 ごろ
    expect(estimateNextEarnings({ financialHistory: goodHistory }, TODAY)).toBe("2026-11-14");
    const est = checkFirstEarningsGap({ item: item(), ipo, enriched: { financialHistory: goodHistory }, todayIso: TODAY }, TODAY);
    expect(est.verdict).toBe("pass");
    expect(est.value).toContain("推定");
    expect(checkFirstEarningsGap({ item: item(), ipo, todayIso: TODAY }, TODAY).verdict).toBe("unknown");
  });
});

function fins(overrides: Partial<FinsItem> = {}): FinsItem {
  return {
    code: "9999",
    fy: { period: "2026-03", sales: 1200, op: 180, np: 100, eqAR: 55, cfo: 50, sharesOutstanding: 10_000_000, discDate: "2026-05-10" },
    prevFy: { period: "2025-03", sales: 1000, op: 120 },
    forecast: null,
    latestQuarter: null,
    ...overrides,
  };
}

describe("講師の 10 項目（追加分は fail を出さない）", () => {
  it("③自己資本比率: 50% 以上クリア・30% 以上注意・それ未満も注意・無ければ不明", () => {
    expect(checkEquityRatio({ item: item(), todayIso: TODAY, fins: fins() }).verdict).toBe("pass");
    const mid = fins({ fy: { ...fins().fy!, eqAR: 35 } });
    expect(checkEquityRatio({ item: item(), todayIso: TODAY, fins: mid }).verdict).toBe("warn");
    const low = checkEquityRatio({ item: item(), todayIso: TODAY, fins: fins({ fy: { ...fins().fy!, eqAR: 10 } }) });
    expect(low.verdict).toBe("warn");
    expect(low.short).toContain("低い");
    expect(checkEquityRatio({ item: item(), todayIso: TODAY }).verdict).toBe("unknown");
    // しきい値を受け取る（保守 60%）
    const strict = { ...DEFAULT_THRESHOLDS, midEquityRatioPassPct: 60 };
    expect(checkEquityRatio({ item: item(), todayIso: TODAY, fins: fins(), thresholds: strict }).verdict).toBe("warn");
  });

  it("③営業CF: プラスでクリア・マイナスは注意・無ければ不明", () => {
    expect(checkOperatingCf({ item: item(), todayIso: TODAY, fins: fins() }).verdict).toBe("pass");
    const neg = checkOperatingCf({ item: item(), todayIso: TODAY, fins: fins({ fy: { ...fins().fy!, cfo: -5e8 } }) });
    expect(neg.verdict).toBe("warn");
    expect(neg.value).toBe("−5億円");
    expect(checkOperatingCf({ item: item(), todayIso: TODAY, fins: fins({ fy: null }) }).verdict).toBe("unknown");
  });

  it("⑦信用買残 ÷ 出来高: 10 倍以下クリア・20 倍以下注意・超えても注意（重い）・無ければ不明", () => {
    const m = (buy: number) => ({ buy, sell: 0 });
    expect(checkMarginRatio({ item: item(), todayIso: TODAY, margin: m(1_000_000) }).verdict).toBe("pass");
    expect(checkMarginRatio({ item: item(), todayIso: TODAY, margin: m(2_250_000) }).verdict).toBe("warn");
    const heavy = checkMarginRatio({ item: item(), todayIso: TODAY, margin: m(4_500_000) });
    expect(heavy.verdict).toBe("warn");
    expect(heavy.short).toBe("信用買残が出来高の 30 倍と重い");
    expect(checkMarginRatio({ item: item(), todayIso: TODAY }).verdict).toBe("unknown");
    expect(checkMarginRatio({ item: item({ avgVolume20: null }), todayIso: TODAY, margin: m(1) }).verdict).toBe("unknown");
  });

  it("④筆頭株主の分類", () => {
    expect(classifyTopHolder("中村 慎吾")).toBe("founder");
    expect(classifyTopHolder("榎並大輔")).toBe("founder");
    expect(classifyTopHolder("エス・エヌ・ホールディングス有限会社")).toBe("assetCompany");
    expect(classifyTopHolder("株式会社ソフトクリエイトホールディングス")).toBe("assetCompany");
    expect(classifyTopHolder("合同会社ABC")).toBe("assetCompany");
    expect(classifyTopHolder("株式会社山田資産管理")).toBe("assetCompany");
    expect(classifyTopHolder("ジャフコSV4共有投資事業有限責任組合")).toBe("vc");
    expect(classifyTopHolder("Atom Investment, L.P.")).toBe("vc");
    expect(classifyTopHolder("DAN TAKAHASHI LLC")).toBe("vc");
    expect(classifyTopHolder("株式会社三菱UFJ銀行")).toBe("vc");
    expect(classifyTopHolder("KDDI株式会社")).toBe("corporate");
    expect(classifyTopHolder("くふうカンパニー")).toBe("corporate");
    expect(classifyTopHolder("株式会社ゼンリン")).toBe("corporate");
  });

  it("④筆頭株主（比率最大）が創業者系ならクリア、VC・事業会社は注意、無ければ不明", () => {
    const holders = (name: string) => ({
      majorShareholders: [
        { name: "ジャフコSV4共有投資事業有限責任組合", shares: 1, ratioPercent: 10, lockupDays: null },
        { name, shares: 1, ratioPercent: 40, lockupDays: null },
      ],
    });
    const pass = checkFounderTop({ item: item(), todayIso: TODAY, enriched: holders("山田 太郎") });
    expect(pass.verdict).toBe("pass");
    expect(pass.short).toBe("筆頭は創業者系（山田 太郎）");
    expect(checkFounderTop({ item: item(), todayIso: TODAY, enriched: holders("KDDI株式会社") }).verdict).toBe("warn");
    expect(checkFounderTop({ item: item(), todayIso: TODAY }).verdict).toBe("unknown");
    expect(checkFounderTop({ item: item(), todayIso: TODAY }).threshold).toContain("有報で確認");
  });

  it("①業種業態（目視）: ◎ クリア 2 点・○ クリア 1 点・× 注意・未設定は不明", () => {
    expect(checkIndustry({ item: item(), todayIso: TODAY, manual: "strong" })).toMatchObject({ verdict: "pass", value: "◎" });
    expect(checkIndustry({ item: item(), todayIso: TODAY, manual: "ok" })).toMatchObject({ verdict: "pass", points: 1 });
    expect(checkIndustry({ item: item(), todayIso: TODAY, manual: "ng" }).verdict).toBe("warn");
    expect(checkIndustry({ item: item(), todayIso: TODAY }).verdict).toBe("unknown");
  });

  it("②業績は J-Quants（直近通期と前期）を優先し、前期が無ければ目論見書に戻る", () => {
    const j = checkGrowth({ item: item(), todayIso: TODAY, fins: fins(), enriched: { financialHistory: goodHistory } });
    expect(j.verdict).toBe("pass");
    expect(j.source).toBe("J-Quants");
    expect(j.value).toContain("増収 20%");
    expect(j.value).toContain("J-Quants");
    const fb = checkGrowth({ item: item(), todayIso: TODAY, fins: fins({ prevFy: null }), enriched: { financialHistory: goodHistory } });
    expect(fb.source).toBe("目論見書");
    expect(fb.value).toContain("増収 30%");
    // 減収は fail（候補から外す。既存挙動）
    const down = checkGrowth({ item: item(), todayIso: TODAY, fins: fins({ fy: { ...fins().fy!, sales: 900 } }) });
    expect(down.verdict).toBe("fail");
  });

  it("②進捗は表示だけ", () => {
    const q = checkProgress({
      item: item(),
      todayIso: TODAY,
      fins: fins({
        latestQuarter: {
          type: "1Q", periodEnd: "2026-06-30", sales: 300, op: 40, discDate: "2026-08-10",
          progressOpPct: 22.2, progressSalesPct: 25, cumulative: true,
        },
      }),
    });
    expect(q.displayOnly).toBe(true);
    expect(q.value).toBe("1Q 進捗 営業益 22.2%（按分 25/50/75）");
    expect(checkProgress({ item: item(), todayIso: TODAY }).value).toBe("—");
  });

  it("⑥時価総額は J-Quants の株数を優先し、分割係数は掛けない", () => {
    const ipo = makeIpo({ code: "9999", splitFactor: 3 } as never);
    // 10,000,000 株 × 400 円 = 40 億円（分割係数 3 は掛けない）
    expect(currentMarketCapOku(item(), { ...ipo, splitFactor: 3 }, { issuedShares: 5_000_000 }, fins())).toBe(40);
    expect(currentMarketCapOku(item(), { ...ipo, splitFactor: 3 }, { issuedShares: 5_000_000 })).toBe(60);
  });

  it("並びは講師の番号順、追加の項目は fail を出さない", () => {
    const checks = runMidChecks({
      item: item(),
      todayIso: TODAY,
      fins: fins({ fy: { ...fins().fy!, eqAR: 5, cfo: -1, sales: 500 } }),
      margin: { buy: 99_000_000, sell: 0 },
      enriched: { majorShareholders: [{ name: "KDDI株式会社", shares: 1, ratioPercent: 50, lockupDays: null }] },
      manual: "ng",
    });
    expect(checks.map((c) => c.id)).toEqual([
      "industry", "growth", "progress", "equityRatio", "operatingCf", "founderTop", "lockupPassed",
      "marketCap50", "marginRatio", "volumeFloor", "drawdown", "reboundFromLow", "firstEarningsGap",
    ]);
    // 新しく足した項目は fail を出さない（②業績の減収・営業赤字だけは既存どおり fail）
    const added = ["industry", "progress", "equityRatio", "operatingCf", "founderTop", "marginRatio"];
    expect(checks.filter((c) => added.includes(c.id)).every((c) => c.verdict !== "fail")).toBe(true);
    expect(monthDayJa("2026-07-10")).toBe("7月10日");
  });
});

describe("rankMidSecondary", () => {
  it("fins・margin・目視を当て、クリア数と判定数を出す。古いファイルは不明扱い", () => {
    const file: MidFile = { asOf: "2026-09-29", generatedAt: "", universe: 1, items: [item({ code: "A", drawdown: -0.7 })] };
    const finsFile: FinsFile = {
      generatedAt: "", asOf: "2026-07-10", source: "J-Quants", delayNote: "無料枠は約12週遅延",
      items: { A: fins({ code: "A" }) },
    };
    const marginFile: MarginFile = { generatedAt: "", asOf: "2026-09-26", sourceUrl: "", items: { A: { buy: 100_000, sell: 0 } } };
    const ipos = [makeIpo({ code: "A", listingDate: "2025-12-01" })];
    const [p] = rankMidSecondary(ipos, file, {}, TODAY, { fins: finsFile, margin: marginFile, manual: { A: "ok" } });
    expect(p.candidate).toBe(true);
    expect(p.manual).toBe("ok");
    const byId = Object.fromEntries(p.checks.map((c) => [c.id, c.verdict]));
    expect(byId).toMatchObject({ industry: "pass", equityRatio: "pass", operatingCf: "pass", marginRatio: "pass", growth: "pass" });
    // ①②③③⑤⑧⑨⑦⑥ が判定できる（④は大株主なし＝不明、⑩は表示だけ）
    expect(p.checkTotal).toBe(9);
    expect(p.passCount).toBe(8); // ⑥ 時価総額 40 億は注意
    const [old] = rankMidSecondary(ipos, file, {}, TODAY, {
      fins: { ...finsFile, asOf: "2026-01-01" },
      margin: { ...marginFile, asOf: "2026-08-01" },
    });
    const oldById = Object.fromEntries(old.checks.map((c) => [c.id, c.verdict]));
    expect(oldById).toMatchObject({ equityRatio: "unknown", operatingCf: "unknown", marginRatio: "unknown" });
    // 目視 ○ は 1 点、◎ は 2 点
    const [strong] = rankMidSecondary(ipos, file, {}, TODAY, { fins: finsFile, margin: marginFile, manual: { A: "strong" } });
    expect(strong.score - p.score).toBe(1);
  });

  it("−60% かつ警戒なしを候補として上に。−50% と警戒ありは候補外", () => {
    const file: MidFile = {
      asOf: "2026-09-29",
      generatedAt: "",
      universe: 40,
      items: [
        item({ code: "A", drawdown: -0.7 }),
        item({ code: "B", drawdown: -0.55 }),
        item({ code: "C", drawdown: -0.65, avgVolume20: 10_000 }),
      ],
    };
    const ipos = ["A", "B", "C"].map((code) => makeIpo({ code, listingDate: "2025-12-01" }));
    const picks = rankMidSecondary(ipos, file, { A: { financialHistory: goodHistory } }, TODAY);
    expect(picks.map((p) => [p.item.code, p.candidate])).toEqual([
      ["A", true],
      ["B", false],
      ["C", false],
    ]);
    expect(picks[0].tier).toBe(60);
    expect(picks[0].reasons.length).toBeLessThanOrEqual(3);
    expect(picks[2].reasons[0]).toMatchObject({ id: "volumeFloor", tone: "bad" });
    expect(rankMidSecondary(ipos, null, {}, TODAY)).toEqual([]);
  });
});
