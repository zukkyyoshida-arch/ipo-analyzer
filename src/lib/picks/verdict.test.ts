import { describe, it, expect } from "vitest";
import { verdictFor, VERDICT_LABELS } from "./verdict";

describe("verdictFor", () => {
  it("BB50以上・公募割れ30%未満・✗2以下なら参加候補", () => {
    expect(verdictFor({ bbScore: 50, breakEvenPct: 29.9, ngCount: 2 })).toBe("join");
  });
  it("境界: BB49・公募割れ30%・✗3は様子見", () => {
    expect(verdictFor({ bbScore: 49, breakEvenPct: 10, ngCount: 0 })).toBe("watch");
    expect(verdictFor({ bbScore: 80, breakEvenPct: 30, ngCount: 0 })).toBe("watch");
    expect(verdictFor({ bbScore: 80, breakEvenPct: 10, ngCount: 3 })).toBe("watch");
  });
  it("公募割れ45%以上か✗4以上なら見送り（BBが高くても）", () => {
    expect(verdictFor({ bbScore: 90, breakEvenPct: 45, ngCount: 0 })).toBe("skip");
    expect(verdictFor({ bbScore: 90, breakEvenPct: 10, ngCount: 4 })).toBe("skip");
  });
  it("材料が null なら参加候補にしない", () => {
    expect(verdictFor({ bbScore: null, breakEvenPct: 10, ngCount: 0 })).toBe("watch");
    expect(verdictFor({ bbScore: 80, breakEvenPct: null, ngCount: 0 })).toBe("watch");
    expect(verdictFor({ bbScore: null, breakEvenPct: null, ngCount: 5 })).toBe("skip");
  });
  it("ラベル", () => {
    expect(VERDICT_LABELS).toEqual({ join: "参加候補", watch: "様子見", skip: "見送り" });
  });
});
