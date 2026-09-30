import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECONDARY_PROFILE,
  HIT_RATES,
  PRESET_BACKTEST,
  RATIO_BAND_STATS,
  SECONDARY_PRESETS,
  clampProfileValue,
  lookupHitRates,
  normalizeSecondaryProfile,
  formatSignedPct,
  ratioBandOf,
} from "./profiles";

describe("SECONDARY_PRESETS", () => {
  it("既定値はバックテストの初期値案どおり", () => {
    expect(SECONDARY_PRESETS.solid).toEqual({
      style: "solid",
      takeProfitPctOfWidth: 50,
      stopLossPct: 10,
      maxHoldDays: 5,
      overheatRatio: 1.5,
    });
    expect(SECONDARY_PRESETS.standard).toEqual({
      style: "standard",
      takeProfitPctOfWidth: 100,
      stopLossPct: 10,
      maxHoldDays: 20,
      overheatRatio: 1.5,
    });
    expect(SECONDARY_PRESETS.aggressive).toEqual({
      style: "aggressive",
      takeProfitPctOfWidth: 200,
      stopLossPct: 10,
      maxHoldDays: 60,
      overheatRatio: 2.0,
    });
    expect(DEFAULT_SECONDARY_PROFILE.style).toBe("standard");
  });
  it("過去の平均と勝率", () => {
    expect(PRESET_BACKTEST.solid).toMatchObject({ meanPct: -0.5, winRatePct: 46 });
    expect(PRESET_BACKTEST.standard).toMatchObject({ meanPct: 1.1, winRatePct: 37 });
    expect(PRESET_BACKTEST.aggressive).toMatchObject({ meanPct: 2.9, winRatePct: 30 });
  });
});

describe("HIT_RATES / lookupHitRates", () => {
  it("到達割合の表（丸めると検証結果の表と一致）", () => {
    expect(Math.round(HIT_RATES[0].takeProfit[25])).toBe(54);
    expect(Math.round(HIT_RATES[5].takeProfit[50])).toBe(54);
    expect(Math.round(HIT_RATES[20].takeProfit[100])).toBe(44);
    expect(Math.round(HIT_RATES[60].takeProfit[200])).toBe(35);
    expect(Math.round(HIT_RATES[20].stopLoss[20])).toBe(54);
    expect(Math.round(HIT_RATES[60].stopLoss[10])).toBe(78);
  });
  it("標準の型は20営業日・値幅100%・−10%の列を引く", () => {
    const r = lookupHitRates(SECONDARY_PRESETS.standard);
    expect(r.horizon).toBe(20);
    expect(r.takeProfitRate).toBe(44.3);
    expect(r.stopLossRate).toBe(74.7);
    expect(r.takeProfitApprox).toBe(false);
    expect(r.horizonApprox).toBe(false);
  });
  it("表に無い値は最も近い列を使い、近い値の印を付ける", () => {
    const r = lookupHitRates({
      style: "custom",
      takeProfitPctOfWidth: 70,
      stopLossPct: 8,
      maxHoldDays: 10,
      overheatRatio: 1.5,
    });
    expect(r.horizon).toBe(5);
    expect(r.takeProfitPct).toBe(50);
    expect(r.stopLossPct).toBe(10);
    expect(r.takeProfitApprox).toBe(true);
    expect(r.stopLossApprox).toBe(true);
    expect(r.horizonApprox).toBe(true);
  });
});

describe("RATIO_BAND_STATS / ratioBandOf", () => {
  it("初値倍率の帯", () => {
    expect(ratioBandOf(1.5)).toBe("le15");
    expect(ratioBandOf(1.51)).toBe("15to20");
    expect(ratioBandOf(2.0)).toBe("15to20");
    expect(ratioBandOf(2.01)).toBe("gt20");
  });
  it("20営業日後の平均", () => {
    expect(RATIO_BAND_STATS.le15.day20.meanPct).toBe(2.5);
    expect(RATIO_BAND_STATS["15to20"].day20.meanPct).toBe(-17.8);
    expect(RATIO_BAND_STATS.gt20.day20.meanPct).toBe(-21.1);
  });
});

describe("normalizeSecondaryProfile / clampProfileValue", () => {
  it("壊れた値は null", () => {
    expect(normalizeSecondaryProfile(null)).toBeNull();
    expect(normalizeSecondaryProfile({ style: "x" })).toBeNull();
  });
  it("既定の型は既定値に揃える", () => {
    expect(normalizeSecondaryProfile({ style: "solid", maxHoldDays: 99 })).toEqual(
      SECONDARY_PRESETS.solid,
    );
  });
  it("カスタムは範囲と刻みに収める", () => {
    expect(
      normalizeSecondaryProfile({
        style: "custom",
        takeProfitPctOfWidth: 999,
        stopLossPct: 1,
        maxHoldDays: "x",
        overheatRatio: 1.3000000000000003,
      }),
    ).toEqual({
      style: "custom",
      takeProfitPctOfWidth: 300,
      stopLossPct: 3,
      maxHoldDays: 20,
      overheatRatio: 1.3,
    });
  });
  it("0.1刻みの足し算の誤差を消す", () => {
    expect(clampProfileValue("overheatRatio", 1.2 + 0.1)).toBe(1.3);
    expect(clampProfileValue("takeProfitPctOfWidth", 104)).toBe(100);
  });
});

describe("formatSignedPct", () => {
  it("符号つき", () => {
    expect(formatSignedPct(2.5)).toBe("+2.5%");
    expect(formatSignedPct(-17.8)).toBe("−17.8%");
    expect(formatSignedPct(0)).toBe("0.0%");
    expect(formatSignedPct(-0.01)).toBe("0.0%");
  });
});
