import { describe, expect, it } from "vitest";
import { PICK_VERDICT_LABELS, pickVerdict, pickVerdictSummary } from "./verdict";

describe("pickVerdict", () => {
  it("BB 50 以上・公募割れ 30% 未満・✗2 以下は参加候補", () => {
    expect(pickVerdict({ bbScore: 50, breakEvenProbability: 0.29, failCount: 2 })).toBe("go");
    expect(pickVerdict({ bbScore: 72, breakEvenProbability: 0.1, failCount: null })).toBe("go");
  });

  it("どれか1つでも届かなければ様子見", () => {
    expect(pickVerdict({ bbScore: 49, breakEvenProbability: 0.1, failCount: 0 })).toBe("watch");
    expect(pickVerdict({ bbScore: 60, breakEvenProbability: 0.3, failCount: 0 })).toBe("watch");
    expect(pickVerdict({ bbScore: 60, breakEvenProbability: 0.1, failCount: 3 })).toBe("watch");
    // 公募割れ確率が分からなければ参加候補にしない
    expect(pickVerdict({ bbScore: 80, breakEvenProbability: null, failCount: 0 })).toBe("watch");
  });

  it("公募割れ 45% 以上か ✗4 以上は見送り（スコアが高くても）", () => {
    expect(pickVerdict({ bbScore: 90, breakEvenProbability: 0.45, failCount: 0 })).toBe("skip");
    expect(pickVerdict({ bbScore: 90, breakEvenProbability: 0.1, failCount: 4 })).toBe("skip");
    expect(pickVerdict({ bbScore: 30, breakEvenProbability: null, failCount: 4 })).toBe("skip");
    expect(pickVerdict({ bbScore: 48, breakEvenProbability: 0.41, failCount: 3 })).toBe("watch");
  });

  it("ラベルは 参加候補・様子見・見送り", () => {
    expect(Object.values(PICK_VERDICT_LABELS)).toEqual(["参加候補", "様子見", "見送り"]);
  });
});

describe("pickVerdictSummary", () => {
  it("BB・公募割れ・✗ を1行にまとめ、数字には必ずラベルを付ける", () => {
    expect(pickVerdictSummary({ bbScore: 48, breakEvenProbability: 0.41, failCount: 3 })).toBe("BB 48 ・ 公募割れ 41% ・ ✗3");
    expect(pickVerdictSummary({ bbScore: 72.4, breakEvenProbability: null, failCount: null })).toBe("BB 72 ・ 公募割れ —");
  });
});
