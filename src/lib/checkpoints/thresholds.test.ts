import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, THRESHOLD_PRESETS, applyPreset, matchPreset, normalizeThresholds } from "./thresholds";

describe("しきい値", () => {
  it("既定値は講師基準と一致する", () => {
    expect(matchPreset(DEFAULT_THRESHOLDS)).toBe("lecturer");
    expect(DEFAULT_THRESHOLDS.capitalYen).toBe(1_000_000);
  });

  it("旧データにキーが無ければ既定で補い、壊れた値は捨てる", () => {
    expect(normalizeThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
    const t = normalizeThresholds({ absorptionOkuMax: 15, supplySharesMax: "x", capitalYen: null });
    expect(t.absorptionOkuMax).toBe(15);
    expect(t.supplySharesMax).toBe(DEFAULT_THRESHOLDS.supplySharesMax);
    expect(t.capitalYen).toBe(DEFAULT_THRESHOLDS.capitalYen);
  });

  it("プリセットを当てても資金はそのまま", () => {
    const t = applyPreset({ ...DEFAULT_THRESHOLDS, capitalYen: 3_000_000 }, "conservative");
    expect(t.capitalYen).toBe(3_000_000);
    expect(t.absorptionOkuMax).toBe(THRESHOLD_PRESETS.conservative.absorptionOkuMax);
    expect(matchPreset(t)).toBe("conservative");
    expect(matchPreset({ ...t, stopLossPct: 99 })).toBeNull();
  });
});
