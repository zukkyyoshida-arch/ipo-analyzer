import { describe, it, expect } from "vitest";
import {
  detectInitialPrice,
  emptyInitialPriceState,
  initialPriceWatchTargets,
  instantCashTargets,
  parseInitialPriceState,
  pruneInitialPriceState,
} from "./initialPrice";
import { baseIpo } from "./fixtures.test-helper";

const TODAY = "2026-10-01";

describe("initialPriceWatchTargets", () => {
  it("当日上場と、初値持ち越し中（4日以内）の初値なし銘柄だけ", () => {
    const ipos = [
      baseIpo({ code: "T001", listingDate: TODAY }),
      baseIpo({ code: "T002", listingDate: "2026-09-29" }),
      baseIpo({ code: "T003", listingDate: TODAY, initialPrice: 1500 }),
      baseIpo({ code: "T004", listingDate: "2026-10-02" }),
      baseIpo({ code: "T005", listingDate: "2026-09-26" }),
      baseIpo({ code: "T006", listingDate: TODAY }),
    ];
    const state = emptyInitialPriceState();
    state.formed.T006 = { date: TODAY, price: 1200 };
    expect(initialPriceWatchTargets(ipos, TODAY, state).map((i) => i.code)).toEqual(["T001", "T002"]);
  });

  it("当日上場が無ければ空（quote を叩かない前提）", () => {
    expect(initialPriceWatchTargets([baseIpo({ listingDate: "2026-09-01" })], TODAY, emptyInitialPriceState())).toEqual([]);
  });
});

describe("instantCashTargets", () => {
  it("当日上場・初値なし・未送信だけ", () => {
    const state = emptyInitialPriceState();
    state.instantCash.C003 = TODAY;
    state.formed.C004 = { date: TODAY, price: 900 };
    const ipos = [
      baseIpo({ code: "C001", listingDate: TODAY }),
      baseIpo({ code: "C002", listingDate: "2026-09-30" }),
      baseIpo({ code: "C003", listingDate: TODAY }),
      baseIpo({ code: "C004", listingDate: TODAY }),
      baseIpo({ code: "C005", listingDate: TODAY, initialPrice: 1100 }),
    ];
    expect(instantCashTargets(ipos, TODAY, state).map((i) => i.code)).toEqual(["C001"]);
  });
});

describe("detectInitialPrice", () => {
  it("出来高のある最初の足の始値を初値とする（出来高 0 の気配だけの日は飛ばす）", () => {
    expect(
      detectInitialPrice(
        [
          { date: "2026-09-29", open: 2300, close: 2300, volume: 0 },
          { date: "2026-09-30", open: 2650, close: 2500, volume: 1200000 },
        ],
        "2026-09-29",
      ),
    ).toEqual({ date: "2026-09-30", price: 2650 });
  });

  it("上場日前日より前の足（コード再利用の別銘柄）は見ない。足が無ければ null", () => {
    expect(detectInitialPrice([{ date: "2026-01-05", open: 500, close: 500, volume: 100 }], TODAY)).toBeNull();
    expect(detectInitialPrice([], TODAY)).toBeNull();
  });
});

describe("状態の読み書き", () => {
  it("壊れた値は空、古い記録は捨てる", () => {
    expect(parseInitialPriceState("x")).toEqual(emptyInitialPriceState());
    const parsed = parseInitialPriceState({
      formed: { A: { date: "2026-09-01", price: 1000 }, B: { date: TODAY, price: 1 }, C: { date: "bad" } },
      instantCash: { D: TODAY, E: 3 },
    });
    expect(parsed).toEqual({
      formed: { A: { date: "2026-09-01", price: 1000 }, B: { date: TODAY, price: 1 } },
      instantCash: { D: TODAY },
    });
    expect(Object.keys(pruneInitialPriceState(parsed, TODAY).formed)).toEqual(["B"]);
  });
});
