import { describe, expect, it } from "vitest";
import { countReached, holdingStatus, lastCumInfo, mergePrice, pickPrice, realizedPnlOf, summarize } from "./judge";
import { parseHoldings, parsePriceCache, type Holding, type PriceCache } from "./types";

function holding(over: Partial<Holding> = {}): Holding {
  return {
    id: "h1",
    code: "7203",
    name: "トヨタ",
    buyPrice: 1000,
    shares: 100,
    buyDate: "2026-09-01",
    strategy: "other",
    rightsMonth: null,
    earningsDate: null,
    memo: "",
    manualPrice: null,
    sold: null,
    ...over,
  };
}

describe("状態の判定（+8% で逆指値引き上げ、+10% で利確）", () => {
  it("目安の株価", () => {
    const s = holdingStatus(1000, null);
    expect(s).toMatchObject({ kind: "unknown", pct: null, targetPrice: 1100, triggerPrice: 1080, stopPrice: 1050 });
  });

  it("+8% 未満は監視中", () => {
    const s = holdingStatus(1000, 1079);
    expect(s.kind).toBe("watch");
    expect(s.pct).toBeCloseTo(7.9);
  });

  it("ちょうど +8%（浮動小数の誤差があっても）で引き上げ", () => {
    expect(holdingStatus(1000, 1080).kind).toBe("trail");
    expect(holdingStatus(2345, 2345 * 1.08).kind).toBe("trail");
  });

  it("+10% 以上は利確", () => {
    expect(holdingStatus(1000, 1100).kind).toBe("takeProfit");
    expect(holdingStatus(1000, 1500).kind).toBe("takeProfit");
  });

  it("下がっていても監視中（マイナスの率）", () => {
    const s = holdingStatus(1000, 900);
    expect(s.kind).toBe("watch");
    expect(s.pct).toBeCloseTo(-10);
  });

  it("目安の株価は円未満を切り上げる", () => {
    expect(holdingStatus(1234, null)).toMatchObject({ targetPrice: 1358, triggerPrice: 1333, stopPrice: 1296 });
  });
});

describe("現在値の選び方", () => {
  it("日付の新しいほう。同じ日なら 取得 > 手入力 > 月足", () => {
    const h = holding({ manualPrice: { price: 1050, date: "2026-10-01" } });
    expect(pickPrice(h, { "7203": { price: 1040, asOf: "2026-09-30", source: "live" } })?.price).toBe(1050);
    expect(pickPrice(h, { "7203": { price: 1040, asOf: "2026-10-01", source: "live" } })?.price).toBe(1040);
    expect(pickPrice(holding(), {})).toBeNull();
  });

  it("古い値で新しい値を上書きしない", () => {
    const cache: PriceCache = { "7203": { price: 1040, asOf: "2026-10-01", source: "live" } };
    expect(mergePrice(cache, "7203", { price: 990, asOf: "2026-09-30", source: "yutai" })).toBe(cache);
    expect(mergePrice(cache, "7203", { price: 990, asOf: "2026-10-01", source: "yutai" })).toBe(cache);
    expect(mergePrice(cache, "7203", { price: 1060, asOf: "2026-10-02", source: "live" })["7203"].price).toBe(1060);
  });
});

describe("合計とバッジ", () => {
  const holdings = [
    holding({ id: "a", code: "1111", buyPrice: 1000, shares: 100 }),
    holding({ id: "b", code: "2222", buyPrice: 500, shares: 200 }),
    holding({ id: "c", code: "3333", buyPrice: 2000, shares: 100 }),
    holding({ id: "d", code: "4444", buyPrice: 1000, shares: 100, sold: { price: 1100, date: "2026-09-20" } }),
  ];
  const cache: PriceCache = {
    "1111": { price: 1100, asOf: "2026-10-01", source: "live" },
    "2222": { price: 540, asOf: "2026-10-01", source: "live" },
  };

  it("投資額・評価額・損益（現在値が無い銘柄は買値で数える）", () => {
    const s = summarize(holdings, cache);
    expect(s.openCount).toBe(3);
    expect(s.invested).toBe(100_000 + 100_000 + 200_000);
    expect(s.value).toBe(110_000 + 108_000 + 200_000);
    expect(s.pnl).toBe(18_000);
    expect(s.pnlPct).toBeCloseTo(4.5);
    expect(s.unpricedCount).toBe(1);
    expect(s.realizedPnl).toBe(10_000);
  });

  it("+8% 以上に届いた保有中の件数（売却済みは数えない）", () => {
    expect(countReached(holdings, cache)).toBe(2);
  });

  it("確定損益", () => {
    expect(realizedPnlOf(holdings[3])).toBe(10_000);
    expect(realizedPnlOf(holdings[0])).toBeNull();
  });
});

describe("権利付最終日までの日数", () => {
  it("優待で権利確定月があるときだけ", () => {
    expect(lastCumInfo(holding({ strategy: "yutai", rightsMonth: 10 }), "2026-10-01")).toEqual({ date: "2026-10-28", days: 27 });
    expect(lastCumInfo(holding(), "2026-10-01")).toBeNull();
  });
});

describe("保存値の読み込み", () => {
  it("形の崩れた保有は落とし、優待でなければ権利確定月を消す", () => {
    const parsed = parseHoldings([
      { id: "a", code: "7203", buyPrice: 1000, shares: 100, strategy: "other", rightsMonth: 3 },
      { id: "b", code: "7203", buyPrice: 0, shares: 100 },
      { id: "c", code: "9984", buyPrice: 5000, shares: 100, strategy: "yutai", rightsMonth: 13 },
      "x",
    ]);
    expect(parsed.map((h) => [h.id, h.rightsMonth])).toEqual([
      ["a", null],
      ["c", null],
    ]);
    expect(parseHoldings({})).toEqual([]);
  });

  it("現在値の置き場は形の崩れた値を落とす", () => {
    expect(
      parsePriceCache({
        "7203": { price: 1000, asOf: "2026-10-01", source: "live" },
        "9984": { price: -1, asOf: "2026-10-01", source: "live" },
        "6758": { price: 1000, asOf: "2026-10-01", source: "?" },
      }),
    ).toEqual({ "7203": { price: 1000, asOf: "2026-10-01", source: "live" } });
  });
});
