import { describe, expect, it } from "vitest";
import {
  applySplitAndInitial,
  cumulativeSplitFactor,
  jstDateOf,
  listingInitialQuote,
  resolveSplitFactor,
  toListingPrice,
  toListingVolume,
  type SplitEvent,
  type SplitTarget,
} from "./split";

/** Yahoo の日足と同じく JST 9:00（UTC 0:00）の時刻を作る。 */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function split(iso: string, numerator: number, denominator = 1): SplitEvent {
  return { date: day(iso), numerator, denominator };
}

// 350A 相当: 2025-04-22 上場（公開価格 4,520円・初値 5,310円・初日出来高 4,511,000株）、
// 2025-10-30 に 1:6 分割。Yahoo の日足は分割調整済みで上場日の始値 885・出来高 27,066,000。
const quotes350A = [
  { date: day("2025-04-21"), open: 850, close: 850, volume: 0 }, // 上場前日の穴埋め行
  { date: day("2025-04-22"), open: 885, close: 1006.6666870117188, volume: 27066000 },
  { date: day("2025-04-23"), open: 1056.6666259765625, close: 880, volume: 15462600 },
  { date: day("2026-09-28"), open: 690, close: 684, volume: 329600 },
];
const splits350A = [split("2025-10-30", 6)];

describe("cumulativeSplitFactor", () => {
  it("分割なしは 1", () => {
    expect(cumulativeSplitFactor([])).toBe(1);
  });

  it("1:6 分割は 6", () => {
    expect(cumulativeSplitFactor(splits350A, "2025-04-22")).toBe(6);
  });

  it("2回の分割は係数の積（1:2 のあと 1:3 で 6）", () => {
    expect(cumulativeSplitFactor([split("2025-06-01", 2), split("2026-01-05", 3)])).toBe(6);
  });

  it("併合（10株→1株）は 1 未満、浮動小数の誤差は丸める", () => {
    expect(cumulativeSplitFactor([split("2025-06-01", 1, 10)])).toBe(0.1);
    expect(cumulativeSplitFactor([split("2025-06-01", 11, 10), split("2026-01-05", 3)])).toBe(3.3);
  });

  it("上場日より前のイベントと不正なイベントは数えない", () => {
    expect(
      cumulativeSplitFactor(
        [split("2025-04-01", 2), split("2025-10-30", 6), split("2025-11-01", 0), split("2025-12-01", 2, 0)],
        "2025-04-22",
      ),
    ).toBe(6);
  });
});

describe("resolveSplitFactor", () => {
  it("取得できた係数を使う", () => {
    expect(resolveSplitFactor(undefined, 6)).toBe(6);
    expect(resolveSplitFactor(1, 2)).toBe(2);
    expect(resolveSplitFactor(2, 6)).toBe(6);
    expect(resolveSplitFactor(undefined, 1)).toBe(1);
  });

  it("前回 1 以外で今回 1（イベントが返らなかった）なら前回値を保つ", () => {
    expect(resolveSplitFactor(6, 1)).toBe(6);
  });

  it("不正な取得値は前回値（無ければ 1）", () => {
    expect(resolveSplitFactor(6, Number.NaN)).toBe(6);
    expect(resolveSplitFactor(undefined, 0)).toBe(1);
  });
});

describe("toListingPrice / toListingVolume", () => {
  it("分割調整済みの値を上場時の単位に戻す", () => {
    expect(toListingPrice(885, 6)).toBe(5310);
    // 247A: Yahoo の単精度の始値 502.8 × 5 = 2514
    expect(toListingPrice(502.79998779296875, 5)).toBe(2514);
    expect(toListingPrice(866.6666870117188, 3)).toBe(2600);
    expect(toListingVolume(27066000, 6)).toBe(4511000);
    expect(toListingVolume(15448000, 5)).toBe(3089600);
  });

  it("係数 1 は値をそのまま返す", () => {
    expect(toListingPrice(264.75, 1)).toBe(264.75);
    expect(toListingVolume(4255900, 1)).toBe(4255900);
  });
});

describe("listingInitialQuote", () => {
  it("穴埋め行を飛ばして初値の足を選び、上場時の単位に戻す", () => {
    expect(listingInitialQuote(quotes350A, 6)).toEqual({
      date: "2025-04-22",
      initialPrice: 5310,
      initialVolume: 4511000,
      adjustedOpen: 885,
      adjustedVolume: 27066000,
    });
  });

  it("取引のある足が無ければ undefined", () => {
    expect(listingInitialQuote([{ date: day("2025-04-22"), open: 100, volume: 0 }], 2)).toBeUndefined();
  });
});

describe("applySplitAndInitial", () => {
  it("既存の分割調整済みの初値（350A: 885）を上場時の単位に直す", () => {
    const record: SplitTarget = { initialPrice: 885, initialVolume: 27066000 };
    const result = applySplitAndInitial(record, quotes350A, splits350A, "2025-04-22");
    expect(result).toEqual({ splitFactor: 6, initialUpdated: true });
    expect(record).toEqual({ splitFactor: 6, initialPrice: 5310, initialVolume: 4511000 });
  });

  it("同じ係数が記録済みなら初値を取り直さない（2回目以降の実行）", () => {
    const record: SplitTarget = { initialPrice: 5310, initialVolume: 4511000, splitFactor: 6 };
    const result = applySplitAndInitial(record, quotes350A, splits350A, "2025-04-22");
    expect(result.initialUpdated).toBe(false);
    expect(record).toEqual({ initialPrice: 5310, initialVolume: 4511000, splitFactor: 6 });
  });

  it("分割なしの銘柄の取得済みの初値には触らない（手修正の 8303 など）", () => {
    const record: SplitTarget = { initialPrice: 1586, initialVolume: 0 };
    const quotes = [{ date: day("2025-12-18"), open: 1632, close: 1640, volume: 5000000 }];
    const result = applySplitAndInitial(record, quotes, [], "2025-12-17");
    expect(result).toEqual({ splitFactor: 1, initialUpdated: false });
    expect(record).toEqual({ initialPrice: 1586, initialVolume: 0, splitFactor: 1 });
  });

  it("分割ありでも記録値が調整済みの値と違えば触らない（手修正・分割前に取り込んだ値）", () => {
    // 8303 のように手で直した初値（上場時の単位）。Yahoo の調整済みの足（2日目 816）とは一致しない。
    const record: SplitTarget = { initialPrice: 1586, initialVolume: 0 };
    const quotes = [{ date: day("2025-12-18"), open: 816, close: 820, volume: 5000000 }];
    const result = applySplitAndInitial(record, quotes, [split("2026-03-01", 2)], "2025-12-17");
    expect(result).toEqual({ splitFactor: 2, initialUpdated: false });
    expect(record).toEqual({ initialPrice: 1586, initialVolume: 0, splitFactor: 2 });
  });

  it("分割前に上場時の単位で取り込んだ初値はそのまま、係数だけ入れる（278A: 取り込み後に 1:2 分割）", () => {
    const record: SplitTarget = { initialPrice: 2162, initialVolume: 2682300 };
    const quotes = [{ date: day("2024-11-29"), open: 1081, close: 1100, volume: 5364600 }];
    const result = applySplitAndInitial(record, quotes, [split("2026-09-29", 2)], "2024-11-29");
    expect(result.initialUpdated).toBe(false);
    expect(record).toEqual({ initialPrice: 2162, initialVolume: 2682300, splitFactor: 2 });
  });

  it("初値持ち越しで初値の足が上場日の翌日でも、記録値が調整済みの始値なら直す（338A）", () => {
    const record: SplitTarget = { initialPrice: 2500, initialVolume: 2059800 };
    const quotes = [
      { date: day("2025-03-27"), open: 790, close: 790, volume: 0 },
      { date: day("2025-03-28"), open: 2500, close: 2400, volume: 2059800 },
    ];
    applySplitAndInitial(record, quotes, [split("2026-03-30", 2)], "2025-03-27");
    expect(record).toEqual({ splitFactor: 2, initialPrice: 5000, initialVolume: 1029900 });
  });

  it("初値が未取得なら日足から取って上場時の単位で入れる（新規上場・分割あり）", () => {
    const record: SplitTarget = {};
    applySplitAndInitial(record, quotes350A, splits350A, "2025-04-22");
    expect(record).toEqual({ splitFactor: 6, initialPrice: 5310, initialVolume: 4511000 });
  });

  it("初値が未取得で分割なしなら従来どおり調整なしの始値・出来高を入れる", () => {
    const record: SplitTarget = {};
    const quotes = [
      { date: day("2025-12-14"), open: 264.75, close: 264.75, volume: 0 },
      { date: day("2025-12-15"), open: 1850, close: 1900, volume: 4255900 },
    ];
    applySplitAndInitial(record, quotes, [], "2025-12-15");
    expect(record).toEqual({ splitFactor: 1, initialPrice: 1850, initialVolume: 4255900 });
  });

  it("記録済みの係数から分割が増えても、上場時の単位の初値は変えず係数だけ更新する（1:2 のあと 1:3）", () => {
    const record: SplitTarget = { initialPrice: 5310, initialVolume: 4511000, splitFactor: 2 };
    applySplitAndInitial(record, quotes350A, [split("2025-06-01", 2), split("2025-10-30", 3)], "2025-04-22");
    expect(record).toEqual({ splitFactor: 6, initialPrice: 5310, initialVolume: 4511000 });
  });
});

describe("jstDateOf", () => {
  it("UTC 0:00（JST 9:00）の時刻を JST の日付にする", () => {
    expect(jstDateOf(day("2025-04-22"))).toBe("2025-04-22");
    expect(jstDateOf(new Date("2025-04-21T15:00:00Z"))).toBe("2025-04-22");
  });
});
