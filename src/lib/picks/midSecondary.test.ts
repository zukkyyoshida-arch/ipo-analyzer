import { describe, expect, it } from "vitest";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import type { MidFile, MidItem } from "@/lib/midterm/file";
import {
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

  it("時価総額: 発行済 × 分割係数 × 終値。50 億超は注意", () => {
    const small = checkMarketCap({ item: item(), ipo, enriched: { issuedShares: 5_000_000 }, todayIso: TODAY });
    expect(small.verdict).toBe("pass");
    expect(small.value).toBe("20億円");
    const big = checkMarketCap({ item: item(), ipo: { ...ipo, splitFactor: 3 }, enriched: { issuedShares: 5_000_000 }, todayIso: TODAY });
    expect(big.verdict).toBe("warn");
  });

  it("ロックアップ: 180 日経過でクリア、前なら残り日数", () => {
    expect(checkLockupPassed({ item: item(), ipo, todayIso: TODAY }, TODAY).verdict).toBe("pass");
    const young = checkLockupPassed({ item: item(), ipo: { ...ipo, listingDate: "2026-06-01" }, todayIso: TODAY }, TODAY);
    expect(young.verdict).toBe("warn");
    expect(young.short).toBe("ロック解除まで 59 日");
  });

  it("業績: 増収 10%・増益 20%・利益率 10% でクリア、減収は警戒、無ければ不明", () => {
    expect(checkGrowth({ item: item(), enriched: { financialHistory: goodHistory }, todayIso: TODAY }).verdict).toBe("pass");
    const down = [goodHistory[0], { ...goodHistory[1], revenue: 900 }];
    expect(checkGrowth({ item: item(), enriched: { financialHistory: down }, todayIso: TODAY }).verdict).toBe("fail");
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

describe("rankMidSecondary", () => {
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
