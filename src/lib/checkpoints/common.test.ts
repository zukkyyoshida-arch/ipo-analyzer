import { describe, expect, it } from "vitest";
import type { FinancialPeriod } from "@/types/enriched";
import { DEFAULT_THRESHOLDS as T } from "./thresholds";
import {
  actualPeriodsNewestFirst,
  checkAbsorption,
  checkGrowth3y,
  checkLockup,
  checkMarketCapScenario,
  checkOa,
  checkOfferingMix,
  checkStockOption,
  checkSupplyShares,
  checkVc,
  runCommonCheckpoints,
} from "./common";
import { makeIpo } from "./fixtures.test-helper";

function fp(period: string, revenue: number, operatingProfit: number): FinancialPeriod {
  return { period, revenue, operatingProfit, netProfit: null, revenueChangePercent: null };
}

describe("growth3y", () => {
  const ipo = makeIpo();
  it("予想の期を除き、新しい順に並べる", () => {
    const periods = actualPeriodsNewestFirst([
      fp("2023年3月期", 1, 1),
      fp("2025年3月期", 3, 3),
      fp("2024年3月期", 2, 2),
      fp("2026年3月期（予想）", 9, 9),
    ]);
    expect(periods.map((p) => p.period)).toEqual(["2025年3月期", "2024年3月期", "2023年3月期"]);
  });

  it("直近 2 期とも増収増益なら pass、売上 2 倍以上なら倍増と書く", () => {
    const r = checkGrowth3y(
      { ipo, enriched: { financialHistory: [fp("2023年3月期", 100, 5), fp("2024年3月期", 150, 10), fp("2025年3月期", 400, 30)] } },
      T,
    );
    expect(r.verdict).toBe("pass");
    expect(r.reason).toContain("倍増");
  });

  it("増収増益が 1 期なら warn", () => {
    const r = checkGrowth3y(
      { ipo, enriched: { financialHistory: [fp("2023年3月期", 100, 50), fp("2024年3月期", 150, 10), fp("2025年3月期", 160, 30)] } },
      T,
    );
    expect(r.verdict).toBe("warn");
    expect(r.reason).not.toContain("倍増");
  });

  it("直近期が減収、または赤字拡大なら fail", () => {
    expect(
      checkGrowth3y({ ipo, enriched: { financialHistory: [fp("2024年3月期", 150, 10), fp("2025年3月期", 140, 30)] } }, T).verdict,
    ).toBe("fail");
    expect(
      checkGrowth3y({ ipo, enriched: { financialHistory: [fp("2024年3月期", 150, -10), fp("2025年3月期", 160, -30)] } }, T).verdict,
    ).toBe("fail");
  });

  it("実績が 1 期以下・業績が無いときは unknown", () => {
    expect(checkGrowth3y({ ipo }, T).verdict).toBe("unknown");
    expect(checkGrowth3y({ ipo, enriched: { financialHistory: [fp("2025年3月期", 1, 1)] } }, T).verdict).toBe("unknown");
  });
});

describe("公募・売出", () => {
  it("公募 70%以上 pass／50%以下 fail／間は warn", () => {
    expect(checkOfferingMix({ ipo: makeIpo({ publicShares: 800, saleShares: 200 }) }, T).verdict).toBe("pass");
    expect(checkOfferingMix({ ipo: makeIpo({ publicShares: 150, saleShares: 850 }) }, T).verdict).toBe("fail");
    expect(checkOfferingMix({ ipo: makeIpo({ publicShares: 600, saleShares: 400 }) }, T).verdict).toBe("warn");
    expect(checkOfferingMix({ ipo: makeIpo({ publicShares: 0, saleShares: 0 }) }, T).verdict).toBe("unknown");
  });

  it("総株数 100 万株以下 pass、2 倍以内 warn、超えたら fail", () => {
    expect(checkSupplyShares({ ipo: makeIpo({ publicShares: 600_000, saleShares: 400_000 }) }, T).verdict).toBe("pass");
    expect(checkSupplyShares({ ipo: makeIpo({ publicShares: 1_500_000, saleShares: 0 }) }, T).verdict).toBe("warn");
    const r = checkSupplyShares({ ipo: makeIpo({ publicShares: 3_000_000, saleShares: 0 }) }, T);
    expect(r.verdict).toBe("fail");
    expect(r.value).toBe("300万株");
  });

  it("しきい値を変えると判定が変わる", () => {
    const ipo = makeIpo({ publicShares: 600_000, saleShares: 400_000 });
    expect(checkSupplyShares({ ipo }, { ...T, supplySharesMax: 500_000 }).verdict).toBe("warn");
  });

  it("OA があれば pass、無ければ warn", () => {
    expect(checkOa({ ipo: makeIpo({ overAllotment: 1000 }) }, T).verdict).toBe("pass");
    expect(checkOa({ ipo: makeIpo({ overAllotment: 0 }) }, T).verdict).toBe("warn");
  });
});

describe("VC・ロックアップ・SO", () => {
  it("VC 10%以下 pass／ロック無しの VC 株があれば fail／多いがロック済みは warn", () => {
    expect(checkVc({ ipo: makeIpo({ vcRatio: 5 }) }, T).verdict).toBe("pass");
    expect(
      checkVc({ ipo: makeIpo({ vcRatio: 5 }), enriched: { vcHoldingShares: 1000, vcLockupShares: 500 } }, T).verdict,
    ).toBe("fail");
    expect(
      checkVc({ ipo: makeIpo({ vcRatio: 30 }), enriched: { vcHoldingShares: 1000, vcLockupShares: 1000 } }, T).verdict,
    ).toBe("warn");
    expect(checkVc({ ipo: makeIpo({ vcRatio: 0 }) }, T).verdict).toBe("unknown");
    expect(checkVc({ ipo: makeIpo({ vcRatio: 0 }), enriched: { vcHoldingShares: 0 } }, T).verdict).toBe("pass");
  });

  it("大株主全員 180 日なら pass、null は全体の日数に従う", () => {
    const r = checkLockup(
      {
        ipo: makeIpo(),
        enriched: {
          majorShareholders: [
            { name: "A", shares: 100, ratioPercent: 50, lockupDays: 180 },
            { name: "B", shares: 100, ratioPercent: 50, lockupDays: null },
          ],
        },
      },
      T,
    );
    expect(r.verdict).toBe("pass");
  });

  it("1.5 倍解除か 180 日未満があれば warn", () => {
    const holders = [{ name: "A", shares: 100, ratioPercent: 50, lockupDays: 180 }];
    expect(
      checkLockup({ ipo: makeIpo({ lockup: { days: 180, hasPriceRelease: true, coverage: 60 } }), enriched: { majorShareholders: holders } }, T)
        .verdict,
    ).toBe("warn");
    expect(
      checkLockup({ ipo: makeIpo(), enriched: { majorShareholders: [{ ...holders[0], lockupDays: 90 }] } }, T).verdict,
    ).toBe("warn");
  });

  it("ロック無しの大株主がいれば fail、株数を value に出す", () => {
    const r = checkLockup(
      {
        ipo: makeIpo(),
        enriched: {
          majorShareholders: [
            { name: "A", shares: 250_000, ratioPercent: 50, lockupDays: 0 },
            { name: "B", shares: 100, ratioPercent: 50, lockupDays: 180 },
          ],
        },
      },
      T,
    );
    expect(r.verdict).toBe("fail");
    expect(r.value).toContain("25万株");
  });

  it("大株主の一覧が無ければ unknown", () => {
    expect(checkLockup({ ipo: makeIpo() }, T).verdict).toBe("unknown");
  });

  it("SO ÷ 発行済 10%以上は warn", () => {
    expect(checkStockOption({ ipo: makeIpo(), enriched: { stockOptionShares: 200, issuedShares: 1000 } }, T).verdict).toBe("warn");
    expect(checkStockOption({ ipo: makeIpo(), enriched: { stockOptionShares: 50, issuedShares: 1000 } }, T).verdict).toBe("pass");
    expect(checkStockOption({ ipo: makeIpo(), enriched: { stockOptionShares: 50 } }, T).verdict).toBe("unknown");
  });
});

describe("規模", () => {
  it("吸収金額 20 億以下 pass／30 億以下 warn／超え fail／0 は unknown", () => {
    expect(checkAbsorption({ ipo: makeIpo({ absorptionAmount: 12 }) }, T).verdict).toBe("pass");
    expect(checkAbsorption({ ipo: makeIpo({ absorptionAmount: 25 }) }, T).verdict).toBe("warn");
    expect(checkAbsorption({ ipo: makeIpo({ absorptionAmount: 80 }) }, T).verdict).toBe("fail");
    expect(checkAbsorption({ ipo: makeIpo({ absorptionAmount: 0 }) }, T).verdict).toBe("unknown");
  });

  it("時価総額は公開価格と初値の両方を出し、判定は unknown", () => {
    const r = checkMarketCapScenario(
      { ipo: makeIpo({ offeringPrice: 1000, initialPrice: 2000 }), enriched: { issuedShares: 3_000_000 } },
      T,
    );
    expect(r.verdict).toBe("unknown");
    expect(r.value).toBe("公開価格で 30億円／初値で 60億円");
  });
});

describe("runCommonCheckpoints", () => {
  it("9 項目を返し、集計が合う", () => {
    const { items, counts } = runCommonCheckpoints({ ipo: makeIpo() }, T);
    expect(items).toHaveLength(9);
    expect(counts.pass + counts.warn + counts.fail + counts.unknown).toBe(9);
    expect(items.map((i) => i.id)).toEqual([
      "growth3y",
      "offeringMix",
      "supplyShares",
      "vc",
      "lockup",
      "stockOption",
      "absorption",
      "oa",
      "marketCapScenario",
    ]);
  });

  it("データがほぼ空でも落ちない", () => {
    const ipo = makeIpo({ publicShares: 0, saleShares: 0, overAllotment: 0, absorptionAmount: 0, vcRatio: 0, offeringPrice: null, marketCap: 0 });
    const { counts } = runCommonCheckpoints({ ipo, enriched: {} }, T);
    expect(counts.unknown).toBe(9);
  });
});
