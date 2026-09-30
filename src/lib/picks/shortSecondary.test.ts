import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS as T } from "@/lib/checkpoints/thresholds";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import {
  listingDayNumber,
  prevBusinessDay,
  rankShortSecondary,
  shareSizing,
  shortDecision,
  shortExits,
  shortStage,
  type ShortForecast,
} from "./shortSecondary";
import { instantCashStatus } from "@/lib/checkpoints/instantCash";

const F: ShortForecast = { center: 1300, low80: 1000, high80: 1800, ratio: 1.3 };

describe("営業日と段階", () => {
  it("前の営業日は土日を飛ばす", () => {
    expect(prevBusinessDay("2026-10-05")).toBe("2026-10-02"); // 月 → 金
    expect(prevBusinessDay("2026-10-01")).toBe("2026-09-30");
  });

  it("上場 N 日目は土日を数えない（上場日 = 1）", () => {
    expect(listingDayNumber("2026-09-25", "2026-09-25")).toBe(1);
    expect(listingDayNumber("2026-09-25", "2026-09-30")).toBe(4);
    expect(listingDayNumber("2026-09-25", "2026-09-24")).toBeNull();
  });

  it("前日〜上場 5 日目が対象", () => {
    expect(shortStage("2026-10-01", "2026-09-30")).toEqual({ kind: "eve" });
    expect(shortStage("2026-10-02", "2026-09-30")).toBeNull();
    expect(shortStage("2026-10-05", "2026-10-02")).toEqual({ kind: "eve" });
    expect(shortStage("2026-09-29", "2026-09-30")).toEqual({ kind: "day", n: 2 });
    expect(shortStage("2026-09-24", "2026-09-30")).toEqual({ kind: "day", n: 5 });
    expect(shortStage("2026-09-23", "2026-09-30")).toBeNull();
    expect(shortStage("", "2026-09-30")).toBeNull();
  });
});

describe("見送り判定", () => {
  const day = { kind: "day", n: 2 } as const;
  it("公募割れ・微上昇・+300% 超は見送り", () => {
    expect(shortDecision(makeIpo({ offeringPrice: 1000, initialPrice: 950 }), day, F, T).kind).toBe("skip");
    expect(shortDecision(makeIpo({ offeringPrice: 1000, initialPrice: 1030 }), day, F, T).text).toContain("+5%");
    expect(shortDecision(makeIpo({ offeringPrice: 1000, initialPrice: 4100 }), day, F, T).text).toContain("+300%");
  });

  it("いまの値段が予想×0.9 以下なら入る目安内、×1.3 以上は見送り", () => {
    expect(shortDecision(makeIpo({ initialPrice: 1100, currentPrice: 1100 }), day, F, T).kind).toBe("entry");
    expect(shortDecision(makeIpo({ initialPrice: 2000, currentPrice: 2000 }), day, F, T).kind).toBe("skip");
    expect(shortDecision(makeIpo({ initialPrice: 1300, currentPrice: 1300 }), day, F, T).kind).toBe("wait");
  });

  it("上場前は様子見", () => {
    expect(shortDecision(makeIpo(), { kind: "eve" }, F, T)).toEqual({ kind: "wait", text: "明日上場" });
  });
});

describe("出る目安・株数・即金規制", () => {
  it("初値があれば初値、無ければ予想初値から円で", () => {
    const e = shortExits(makeIpo({ initialPrice: 2000 }), F, T);
    expect(e).toMatchObject({ baseLabel: "初値", takeProfitSmall: 2040, takeProfit: 2200, stopLoss: 1800 });
    expect(shortExits(makeIpo(), F, T)?.baseLabel).toBe("予想初値");
    expect(shortExits(makeIpo(), null, T)).toBeNull();
  });

  it("資金 100 万 × 50% ÷ 値段 を 100 株単位で切り捨て", () => {
    expect(shareSizing(1300, T)).toEqual({ price: 1300, shares: 300, amount: 390_000 });
    expect(shareSizing(6000, T)?.shares).toBe(0);
    expect(shareSizing(null, T)).toBeNull();
  });

  it("予想倍率 2.3 以上は可能性あり、2 日目以降で初値が無く出来高 0 なら規制中", () => {
    expect(instantCashStatus(2.5, { initialPrice: null, initialVolume: null }, null, 2.3)).toBe("likely");
    expect(instantCashStatus(1.5, { initialPrice: null, initialVolume: null }, null, 2.3)).toBeNull();
    expect(instantCashStatus(2.5, { initialPrice: null, initialVolume: 0 }, 2, 2.3)).toBe("active");
    expect(instantCashStatus(2.5, { initialPrice: 3000, initialVolume: 100 }, 2, 2.3)).toBeNull();
  });
});

describe("rankShortSecondary", () => {
  it("pass 数の多い順 → 上場日の近い順に並べ、対象外は落とす", () => {
    const strong = makeIpo({ code: "A", listingDate: "2026-09-25", initialPrice: 1500, currentPrice: 1500 });
    const weak = makeIpo({ code: "B", listingDate: "2026-10-01", absorptionAmount: 100, overAllotment: 0 });
    const out = makeIpo({ code: "C", listingDate: "2026-08-01" });
    const picks = rankShortSecondary(
      [strong, weak, out],
      [
        { code: "B", forecast: F },
        { code: "A", forecast: F },
        { code: "C", forecast: F },
      ],
      {},
      T,
      "2026-09-30",
    );
    expect(picks.map((p) => p.ipo.code)).toEqual(["A", "B"]);
    expect(picks[0].stage).toEqual({ kind: "day", n: 4 });
    expect(picks[0].note).toContain("あと 1 日");
    expect(picks[1].entryMax).toBe(1170);
    expect(picks[1].skipAbove).toBe(1690);
    expect(picks[1].chips.length).toBeLessThanOrEqual(3);
  });
});

describe("buildShortSecondaryInputs", () => {
  it("対象期間で、公開価格か吸収金額が分かる銘柄だけ", async () => {
    const { buildShortSecondaryInputs } = await import("./shortSecondary");
    const inputs = buildShortSecondaryInputs(
      [
        makeIpo({ code: "A", listingDate: "2026-10-01" }),
        makeIpo({ code: "B", listingDate: "2026-10-01", offeringPrice: null, absorptionAmount: 0 }),
        makeIpo({ code: "C", listingDate: "2026-11-01" }),
      ],
      [],
      [],
      "2026-09-30",
    );
    expect(inputs.map((i) => i.code)).toEqual(["A"]);
  });
});
