import { describe, expect, it } from "vitest";
import {
  isSameSyncData,
  isSyncDataShape,
  mergeSyncData,
  normalizeSyncData,
  stableStringify,
} from "./merge";
import type { SyncData } from "./types";

function data(partial: Partial<SyncData> = {}): SyncData {
  return { watchlist: [], bb: {}, notes: {}, ...partial };
}

describe("mergeSyncData", () => {
  it("remote が null ならローカルをそのまま返す", () => {
    const local = data({ watchlist: ["1234"], notes: { "1234": "メモ" } });
    expect(mergeSyncData(null, local, null)).toEqual(local);
  });

  it("初回（base なし）は和集合。両方にある項目はローカル優先", () => {
    const local = data({ watchlist: ["1111"], notes: { "1111": "ローカル", "2222": "L" } });
    const remote = data({ watchlist: ["2222"], notes: { "2222": "R", "3333": "R3" } });
    const merged = mergeSyncData(null, local, remote);
    expect(merged.watchlist).toEqual(["1111", "2222"]);
    expect(merged.notes).toEqual({ "1111": "ローカル", "2222": "L", "3333": "R3" });
  });

  it("ローカルで変更していない項目はリモートの変更を取り込む", () => {
    const base = data({ notes: { "1111": "古い" } });
    const local = data({ notes: { "1111": "古い" } });
    const remote = data({ notes: { "1111": "他端末で更新" } });
    expect(mergeSyncData(base, local, remote).notes).toEqual({ "1111": "他端末で更新" });
  });

  it("ローカルで変更した項目はリモートより優先する", () => {
    const base = data({ notes: { "1111": "古い" } });
    const local = data({ notes: { "1111": "この端末で更新" } });
    const remote = data({ notes: { "1111": "他端末で更新" } });
    expect(mergeSyncData(base, local, remote).notes).toEqual({ "1111": "この端末で更新" });
  });

  it("ウォッチ: ローカルで外した銘柄はリモートにあっても外れる", () => {
    const base = data({ watchlist: ["1111", "2222"] });
    const local = data({ watchlist: ["2222"] });
    const remote = data({ watchlist: ["1111", "2222", "3333"] });
    expect(mergeSyncData(base, local, remote).watchlist).toEqual(["2222", "3333"]);
  });

  it("ウォッチ: リモートで外された銘柄はローカルが未変更なら外れる", () => {
    const base = data({ watchlist: ["1111", "2222"] });
    const local = data({ watchlist: ["1111", "2222", "4444"] });
    const remote = data({ watchlist: ["2222"] });
    expect(mergeSyncData(base, local, remote).watchlist).toEqual(["2222", "4444"]);
  });

  it("BB記録は銘柄×証券会社の単位でマージする", () => {
    const base = data({
      bb: { "1111": { sbi: { status: "applied" }, rakuten: { status: "applied" } } },
    });
    const local = data({
      bb: { "1111": { sbi: { status: "won" }, rakuten: { status: "applied" } } },
    });
    const remote = data({
      bb: {
        "1111": { sbi: { status: "lost" }, rakuten: { status: "lost" } },
        "2222": { monex: { status: "planned", memo: "資金確認" } },
      },
    });
    expect(mergeSyncData(base, local, remote).bb).toEqual({
      "1111": { sbi: { status: "won" }, rakuten: { status: "lost" } },
      "2222": { monex: { status: "planned", memo: "資金確認" } },
    });
  });

  it("BB記録: ローカルで「未対応」に戻した記録は削除として扱う", () => {
    const base = data({ bb: { "1111": { sbi: { status: "applied" } } } });
    const local = data({ bb: { "1111": { sbi: { status: "none" } } } });
    const remote = data({ bb: { "1111": { sbi: { status: "applied" } } } });
    expect(mergeSyncData(base, local, remote).bb).toEqual({});
  });

  it("メモ: ローカルで消したメモはリモートにあっても消える／リモートで消したメモは未変更なら消える", () => {
    const base = data({ notes: { "1111": "a", "2222": "b" } });
    const local = data({ notes: { "2222": "b" } });
    const remote = data({ notes: { "1111": "a" } });
    expect(mergeSyncData(base, local, remote).notes).toEqual({});
  });

  it("同じ入力で同じ結果（冪等）: マージ結果を再マージしても変わらない", () => {
    const base = data({ watchlist: ["1111"] });
    const local = data({ watchlist: ["1111", "2222"], notes: { "2222": "x" } });
    const remote = data({ watchlist: ["1111", "3333"] });
    const merged = mergeSyncData(base, local, remote);
    expect(mergeSyncData(merged, merged, merged)).toEqual(merged);
  });
});

describe("normalizeSyncData", () => {
  it("壊れた値・重複・空メモ・未対応のみの BB 記録を落とす", () => {
    expect(
      normalizeSyncData({
        watchlist: ["1111", "1111", 3, ""],
        bb: { "1111": { sbi: { status: "none" }, mizuho: { status: "bogus", memo: "m" } }, "2222": 5 },
        notes: { "1111": "", "2222": "ok", "3333": 1 },
      }),
    ).toEqual({
      watchlist: ["1111"],
      bb: { "1111": { mizuho: { status: "none", memo: "m" } } },
      notes: { "2222": "ok" },
    });
  });

  it("オブジェクト以外は空データ", () => {
    expect(normalizeSyncData(null)).toEqual({ watchlist: [], bb: {}, notes: {} });
    expect(normalizeSyncData([1])).toEqual({ watchlist: [], bb: {}, notes: {} });
  });
});

describe("isSyncDataShape / isSameSyncData / stableStringify", () => {
  it("形の検証", () => {
    expect(isSyncDataShape({ watchlist: [], bb: {}, notes: {} })).toBe(true);
    expect(isSyncDataShape({ watchlist: {}, bb: {}, notes: {} })).toBe(false);
    expect(isSyncDataShape(null)).toBe(false);
  });

  it("キー順が違っても同じ内容なら同一とみなす", () => {
    const a = data({ notes: { a: "1", b: "2" }, bb: { x: { s: { status: "won", memo: "" } } } });
    const b = data({ notes: { b: "2", a: "1" }, bb: { x: { s: { status: "won" } } } });
    expect(isSameSyncData(a, b)).toBe(true);
    expect(isSameSyncData(a, data())).toBe(false);
    expect(isSameSyncData(null, null)).toBe(true);
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });
});
