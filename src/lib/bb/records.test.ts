import { describe, it, expect } from "vitest";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { BbState } from "@/types/userData";
import { summarizeMyRecords } from "./records";

function ipo(code: string, offeringPrice: number | null, initialPrice: number | null): Ipo {
  return { code, offeringPrice, initialPrice } as Ipo;
}

function broker(id: string): Broker {
  return {
    id,
    name: `${id}証券`,
    lotteryType: "equal",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 0,
  };
}

const brokers = [broker("a"), broker("b"), broker("c")];

describe("summarizeMyRecords", () => {
  it("記録が空なら全て0・当選率 null・損益 null", () => {
    const r = summarizeMyRecords([], brokers, {});
    expect(r.perBroker).toEqual([]);
    expect(r.totals).toMatchObject({ applied: 0, won: 0, decided: 0, winRate: null });
    expect(r.estimatedPnl).toEqual({ count: 0, amount: null, excludedCount: 0 });
    expect(r.sampleNote).toContain("目安として弱い");
  });

  it("申込予定・未対応は申込数に含めない", () => {
    const state: BbState = {
      "1000": { a: { status: "planned" }, b: { status: "none" }, c: { status: "applied" } },
    };
    const r = summarizeMyRecords([], brokers, state);
    expect(r.totals.applied).toBe(1);
    expect(r.perBroker.map((p) => p.broker.id)).toEqual(["c"]);
  });

  it("口座別に申込・当選・補欠・落選を数え、当選率は結果判明分を母数にする", () => {
    const state: BbState = {
      "1000": { a: { status: "won" }, b: { status: "lost" } },
      "2000": { a: { status: "lost" }, b: { status: "waitlist" } },
      "3000": { a: { status: "applied" }, b: { status: "purchased" } },
    };
    const r = summarizeMyRecords([], brokers, state);
    const a = r.perBroker.find((p) => p.broker.id === "a")!;
    const b = r.perBroker.find((p) => p.broker.id === "b")!;
    expect(a).toMatchObject({ applied: 3, won: 1, lost: 1, waitlist: 0, decided: 2, winRate: 0.5 });
    expect(b).toMatchObject({ applied: 3, won: 1, lost: 1, waitlist: 1, decided: 3 });
    expect(b.winRate).toBeCloseTo(1 / 3);
    expect(r.totals).toMatchObject({ applied: 6, won: 2, decided: 5, winRate: 0.4 });
    expect(r.sampleNote).not.toContain("弱い");
  });

  it("辞退は当選として数えるが損益の対象外", () => {
    const state: BbState = { "1000": { a: { status: "declined" } } };
    const r = summarizeMyRecords([ipo("1000", 1000, 2000)], brokers, state);
    expect(r.totals.won).toBe(1);
    expect(r.estimatedPnl).toEqual({ count: 0, amount: null, excludedCount: 0 });
  });

  it("当選・購入済は (初値−公開価格)×100株 を合算し、公募割れはマイナスで計上", () => {
    const state: BbState = {
      "1000": { a: { status: "won" }, b: { status: "purchased" } },
      "2000": { a: { status: "won" } },
    };
    const r = summarizeMyRecords([ipo("1000", 1000, 1500), ipo("2000", 2000, 1800)], brokers, state);
    // 500×100×2 − 200×100 = 80,000
    expect(r.estimatedPnl).toEqual({ count: 3, amount: 80000, excludedCount: 0 });
  });

  it("公開価格・初値のどちらかが欠損、または銘柄が見つからない記録は除外して計上", () => {
    const state: BbState = {
      "1000": { a: { status: "won" } },
      "2000": { a: { status: "won" } },
      "3000": { a: { status: "purchased" } },
      "9999": { a: { status: "won" } },
    };
    const r = summarizeMyRecords(
      [ipo("1000", 1000, null), ipo("2000", null, 2000), ipo("3000", 1000, 1100)],
      brokers,
      state,
    );
    expect(r.estimatedPnl).toEqual({ count: 1, amount: 10000, excludedCount: 3 });
  });

  it("マスタに無い口座IDの記録は集計しない", () => {
    const state: BbState = { "1000": { unknown: { status: "won" }, a: { status: "lost" } } };
    const r = summarizeMyRecords([], brokers, state);
    expect(r.totals).toMatchObject({ applied: 1, won: 0, lost: 1 });
    expect(r.perBroker.map((p) => p.broker.id)).toEqual(["a"]);
  });

  it("perBroker は証券会社マスタの順", () => {
    const state: BbState = { "1000": { c: { status: "lost" }, a: { status: "lost" } } };
    const r = summarizeMyRecords([], brokers, state);
    expect(r.perBroker.map((p) => p.broker.id)).toEqual(["a", "c"]);
  });
});
