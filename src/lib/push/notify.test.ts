import { describe, it, expect } from "vitest";
import type { CalendarEvent, CalendarEventKind } from "@/lib/events";
import type { Ipo } from "@/types/ipo";
import type { PushEventKind } from "@/types/push";
import {
  buildPayload,
  buildPriceSnapshot,
  detectPriceChanges,
  parsePriceSnapshot,
  type PriceSnapshotEntry,
  payloadsForSubscriber,
  priceReleaseWatchCodes,
  PUSH_EVENT_KINDS,
  selectNotifiableEvents,
} from "./notify";
import { baseIpo, FORBIDDEN_WORDS } from "./fixtures.test-helper";

const TODAY = "2026-09-25";

function ev(ipo: Ipo, kind: CalendarEventKind, date: string): CalendarEvent {
  return { ipo, kind, date, detail: "" };
}

describe("selectNotifiableEvents", () => {
  it("明日のBB開始・明日の抽選だけを拾い、今日や明後日は拾わない", () => {
    const a = baseIpo({ code: "A001", bbPeriod: { start: "2026-09-26", end: "2026-10-01" } });
    const b = baseIpo({ code: "B002" });
    const payloads = selectNotifiableEvents(
      [
        ev(a, "bbStart", "2026-09-26"),
        ev(b, "bbStart", "2026-09-25"),
        ev(b, "bbStart", "2026-09-27"),
        ev(a, "allotment", "2026-09-26"),
        ev(b, "allotment", "2026-09-25"),
      ],
      TODAY,
    );
    expect(payloads.map((p) => [p.kind, p.code])).toEqual([
      ["allotment", "A001"],
      ["bbStart", "A001"],
    ]);
  });

  it("購入期限は当日（purchaseEnd = today）のみ purchaseDeadline になる", () => {
    const a = baseIpo({ code: "A001" });
    const payloads = selectNotifiableEvents(
      [ev(a, "purchaseEnd", "2026-09-25"), ev(a, "purchaseEnd", "2026-09-26"), ev(a, "purchaseStart", "2026-09-25")],
      TODAY,
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0].kind).toBe("purchaseDeadline");
    expect(payloads[0].title).toContain("本日購入期限");
  });

  it("ロックアップ解除は3日前と当日の2回だけ（1・2日前、4日後、過去は対象外）", () => {
    const mk = (code: string) => baseIpo({ code, lockup: { days: 90, hasPriceRelease: false, coverage: 60 } });
    const payloads = selectNotifiableEvents(
      [
        ev(mk("L000"), "lockupExpiry", "2026-09-25"),
        ev(mk("L001"), "lockupExpiry", "2026-09-26"),
        ev(mk("L002"), "lockupExpiry", "2026-09-27"),
        ev(mk("L003"), "lockupExpiry", "2026-09-28"),
        ev(mk("L004"), "lockupExpiry", "2026-09-29"),
        ev(mk("LPST"), "lockupExpiry", "2026-09-24"),
      ],
      TODAY,
    );
    expect(payloads.map((p) => p.code)).toEqual(["L000", "L003"]);
    expect(payloads[0].title).toContain("本日ロックアップ解除");
    expect(payloads[1].title).toContain("ロックアップ解除まで3日");
  });

  it("1.5倍ライン監視は前回監視中だった銘柄を除き、新規に入った銘柄だけ通知する", () => {
    const opts = { lockup: { days: 180, hasPriceRelease: true, coverage: 60 }, offeringPrice: 1000, currentPrice: 1450 };
    const events = [
      ev(baseIpo({ code: "P001", ...opts }), "priceReleaseWatch", TODAY),
      ev(baseIpo({ code: "P002", ...opts }), "priceReleaseWatch", TODAY),
    ];
    expect(selectNotifiableEvents(events, TODAY).map((p) => p.code)).toEqual(["P001", "P002"]);
    expect(
      selectNotifiableEvents(events, TODAY, { previousWatchCodes: ["P001"] }).map((p) => p.code),
    ).toEqual(["P002"]);
    expect(priceReleaseWatchCodes(events, TODAY)).toEqual(["P001", "P002"]);
  });

  it("対象外の種別（上場・大量保有・BB締切）と、3日前・前日以外の初決算は通知しない", () => {
    const a = baseIpo({ code: "A001" });
    const payloads = selectNotifiableEvents(
      [
        ev(a, "listing", "2026-09-26"),
        ev(a, "firstEarnings", "2026-09-27"),
        ev(a, "firstEarnings", TODAY),
        ev(a, "largeHoldingReport", TODAY),
        ev(a, "bbEnd", "2026-09-26"),
      ],
      TODAY,
    );
    expect(payloads).toEqual([]);
  });

  it("初決算は3日前と前日の2回だけ earningsAhead になる", () => {
    const mk = (code: string, date: string) => baseIpo({ code, firstEarningsDate: date });
    const payloads = selectNotifiableEvents(
      [
        ev(mk("E001", "2026-09-26"), "firstEarnings", "2026-09-26"),
        ev(mk("E002", "2026-09-27"), "firstEarnings", "2026-09-27"),
        ev(mk("E003", "2026-09-28"), "firstEarnings", "2026-09-28"),
        ev(mk("E004", "2026-09-29"), "firstEarnings", "2026-09-29"),
      ],
      TODAY,
    );
    expect(payloads.map((p) => `${p.kind}:${p.code}`)).toEqual(["earningsAhead:E001", "earningsAhead:E003"]);
    expect(payloads[0].title).toBe("明日初決算：テスト銘柄（E001）");
    expect(payloads[0].body).toBe("上場後最初の決算発表が9/26に予定されています（参考情報）。");
    expect(payloads[1].title).toBe("初決算まで3日：テスト銘柄（E003）");
  });

  it("同じ銘柄×種別の重複は1件にまとめ、種別の優先順→コード順で並ぶ", () => {
    const a = baseIpo({ code: "B002", lockup: { days: 90, hasPriceRelease: false, coverage: 60 } });
    const b = baseIpo({ code: "A001" });
    const payloads = selectNotifiableEvents(
      [
        ev(a, "lockupExpiry", "2026-09-28"),
        ev(a, "lockupExpiry", "2026-09-28"),
        ev(b, "bbStart", "2026-09-26"),
        ev(a, "bbStart", "2026-09-26"),
        ev(b, "purchaseEnd", TODAY),
      ],
      TODAY,
    );
    expect(payloads.map((p) => `${p.kind}:${p.code}`)).toEqual([
      "purchaseDeadline:A001",
      "bbStart:A001",
      "bbStart:B002",
      "lockupExpiry:B002",
    ]);
  });
});

describe("buildPayload", () => {
  it("全種別で銘柄名・コード・詳細URLが入り、禁止語を含まない", () => {
    const ipo = baseIpo({
      code: "648A",
      name: "ルクレ",
      bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
      allotmentDate: "2026-10-05",
      purchasePeriod: { start: "2026-10-06", end: "2026-10-09" },
      lockup: { days: 90, hasPriceRelease: true, coverage: 60 },
      currentPrice: 1420,
    });
    for (const kind of PUSH_EVENT_KINDS) {
      const p = buildPayload(kind, ipo, { date: "2026-09-29", daysUntil: 2 });
      expect(p.kind).toBe(kind);
      expect(p.code).toBe("648A");
      expect(p.url).toBe("/ipo/648A");
      expect(p.title).toContain("ルクレ（648A）");
      expect(p.body.length).toBeGreaterThan(0);
      for (const word of FORBIDDEN_WORDS) {
        expect(`${p.title}${p.body}`).not.toContain(word);
      }
    }
  });

  it("BB開始は期間、1.5倍ラインは公開価格比の倍率を本文に入れる", () => {
    const ipo = baseIpo({
      bbPeriod: { start: "2026-09-29", end: "2026-10-02" },
      offeringPrice: 1000,
      currentPrice: 1450,
    });
    expect(buildPayload("bbStart", ipo).body).toContain("2026/09/29〜2026/10/02");
    expect(buildPayload("priceReleaseWatch", ipo).body).toContain("1.45倍");
  });

  it("株式分割後の1.5倍ライン監視は直近終値を上場時の単位に直した倍率を入れる", () => {
    const ipo = baseIpo({ offeringPrice: 1000, currentPrice: 725, splitFactor: 2 });
    expect(buildPayload("priceReleaseWatch", ipo).body).toContain("公開価格の1.45倍");
  });
});

describe("buildPayload（初値決定・即金規制）", () => {
  it("初値は公開価格比と予想レンジ内/外を入れる", () => {
    const ipo = baseIpo({ code: "648A", name: "ルクレ", offeringPrice: 1000 });
    const inRange = buildPayload("initialPriceFormed", ipo, { initialPrice: 1800, forecastRange: { low: 1500, high: 2100 } });
    expect(inRange.title).toBe("初値決定：ルクレ（648A）");
    expect(inRange.body).toBe("初値は1,800円（公開価格比 ×1.80、予想レンジ1,500円〜2,100円の範囲内）です（参考情報）。");
    expect(
      buildPayload("initialPriceFormed", ipo, { initialPrice: 2500, forecastRange: { low: 1500, high: 2100 } }).body,
    ).toContain("予想レンジ1,500円〜2,100円を上回る");
    expect(
      buildPayload("initialPriceFormed", ipo, { initialPrice: 1200, forecastRange: { low: 1500, high: 2100 } }).body,
    ).toContain("を下回る");
  });

  it("予想が無ければ公開価格比だけ、初値も無ければ定型文", () => {
    const ipo = baseIpo({ offeringPrice: 1000 });
    expect(buildPayload("initialPriceFormed", ipo, { initialPrice: 950 }).body).toBe(
      "初値は950円（公開価格比 ×0.95）です（参考情報）。",
    );
    expect(buildPayload("initialPriceFormed", ipo).body).toContain("初値が付きました");
  });

  it("即金規制は可能性として伝え、参考情報に限る", () => {
    const p = buildPayload("instantCashRegulation", baseIpo({ code: "Z999" }));
    expect(p.title).toBe("即金規制の可能性：テスト銘柄（Z999）");
    expect(p.body).toBe(
      "上場初日は初値が付きませんでした。明日は即金規制（現金・指値のみ）となる可能性があります（参考情報）。",
    );
  });
});

describe("payloadsForSubscriber", () => {
  const payloads = (["purchaseDeadline", "allotment", "bbStart", "lockupExpiry", "priceReleaseWatch"] as PushEventKind[]).flatMap(
    (kind) => ["A001", "B002"].map((code) => ({ kind, code, title: "", body: "", url: "" })),
  );

  it("enabledKinds と watchedCodes の両方に一致するものだけ残す", () => {
    const out = payloadsForSubscriber(payloads, { enabledKinds: ["bbStart", "allotment"], watchedCodes: ["B002"] });
    expect(out.map((p) => `${p.kind}:${p.code}`)).toEqual(["allotment:B002", "bbStart:B002"]);
  });

  it("watchedCodes が空なら何も送らない（ウォッチリストの銘柄のみ）", () => {
    expect(payloadsForSubscriber(payloads, { enabledKinds: PUSH_EVENT_KINDS, watchedCodes: [] })).toEqual([]);
  });

  it("上限件数で打ち切る", () => {
    const out = payloadsForSubscriber(payloads, { enabledKinds: PUSH_EVENT_KINDS, watchedCodes: ["A001", "B002"] }, 3);
    expect(out).toHaveLength(3);
  });
});

describe("detectPriceChanges（仮条件発表・公開価格決定）", () => {
  function snap(code: string, over: Partial<PriceSnapshotEntry> = {}): PriceSnapshotEntry {
    return { code, name: `銘柄${code}`, assumedPrice: 1000, priceRange: null, offeringPrice: null, ...over };
  }

  it("初回（前回スナップショット無し）は通知しない", () => {
    const current = [snap("A001", { priceRange: { low: 1100, high: 1200 }, offeringPrice: 1200 })];
    expect(detectPriceChanges(null, current)).toEqual([]);
    expect(detectPriceChanges(undefined, current)).toEqual([]);
  });

  it("仮条件が未取得→取得で発表を通知し、想定価格比の上振れを数値で入れる", () => {
    const out = detectPriceChanges([snap("A001")], [snap("A001", { priceRange: { low: 1100, high: 1200 } })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "priceRangeAnnounced", code: "A001", url: "/ipo/A001" });
    expect(out[0].title).toBe("仮条件発表：銘柄A001（A001）");
    expect(out[0].body).toContain("1,100円〜1,200円");
    expect(out[0].body).toContain("上振れ（下限で+10.0%）");
  });

  it("仮条件の下振れ・範囲内もそれぞれ数値つきで表す", () => {
    const down = detectPriceChanges([snap("D001")], [snap("D001", { priceRange: { low: 850, high: 950 } })]);
    expect(down[0].body).toContain("下振れ（上限で-5.0%）");
    const mid = detectPriceChanges([snap("M001")], [snap("M001", { priceRange: { low: 950, high: 1050 } })]);
    expect(mid[0].body).toContain("範囲内（下限-5.0%／上限+5.0%）");
  });

  it("公開価格が null→数値で決定を通知し、仮条件内の位置を添える", () => {
    const range = { low: 950, high: 1050 };
    const out = detectPriceChanges(
      [snap("A001", { priceRange: range })],
      [snap("A001", { priceRange: range, offeringPrice: 1050 })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("offeringPriceDecided");
    expect(out[0].body).toContain("公開価格は1,050円に決まりました");
    expect(out[0].body).toContain("仮条件の上限（950円〜1,050円）");
    expect(out[0].body).toContain("想定価格比+5.0%");
  });

  it("変化なし・前回に無い銘柄・値の更新（取得済→別値）は通知しない", () => {
    const range = { low: 950, high: 1050 };
    const prev = [snap("A001", { priceRange: range, offeringPrice: 1000 }), snap("B002")];
    const current = [
      snap("A001", { priceRange: { low: 960, high: 1060 }, offeringPrice: 1060 }),
      snap("B002"),
      snap("N003", { priceRange: range, offeringPrice: 1000 }),
    ];
    expect(detectPriceChanges(prev, current)).toEqual([]);
  });

  it("複数銘柄・同時の発表と決定をまとめて返し、種別優先順→コード順に並べる", () => {
    const prev = [snap("B002"), snap("A001"), snap("C003")];
    const current = [
      snap("B002", { priceRange: { low: 1000, high: 1100 } }),
      snap("A001", { priceRange: { low: 1000, high: 1100 }, offeringPrice: 1100 }),
      snap("C003", { priceRange: { low: 900, high: 1000 } }),
    ];
    const out = detectPriceChanges(prev, current);
    expect(out.map((p) => `${p.kind}:${p.code}`)).toEqual([
      "offeringPriceDecided:A001",
      "priceRangeAnnounced:A001",
      "priceRangeAnnounced:B002",
      "priceRangeAnnounced:C003",
    ]);
    for (const p of out) {
      for (const word of FORBIDDEN_WORDS) expect(`${p.title}${p.body}`).not.toContain(word);
    }
  });

  it("スナップショットは想定価格だけの仮置きレンジと埋め値の公開価格を未取得にする", () => {
    const [placeholder, known] = buildPriceSnapshot([
      baseIpo({ code: "P001", assumedPrice: 1000, priceRange: { low: 1000, high: 1000 }, offeringPrice: 1000 }),
      baseIpo({ code: "Q002", assumedPrice: 1000, priceRange: { low: 950, high: 1050 }, offeringPrice: null }),
    ]);
    expect(placeholder).toMatchObject({ code: "P001", priceRange: null, offeringPrice: null });
    expect(known).toMatchObject({ code: "Q002", priceRange: { low: 950, high: 1050 }, offeringPrice: null });
  });

  it("KV の壊れた値は null、配列は検証して読む", () => {
    expect(parsePriceSnapshot({})).toBeNull();
    expect(parsePriceSnapshot([{ code: "A001", priceRange: { low: 1, high: 2 } }, { foo: 1 }])).toEqual([
      { code: "A001", name: "A001", assumedPrice: 0, priceRange: { low: 1, high: 2 }, offeringPrice: null },
    ]);
  });

  it("v1 の全種別で登録済みの購読は新種別も受け取る", () => {
    const p = { kind: "priceRangeAnnounced" as const, code: "A001", title: "", body: "", url: "" };
    const v1: PushEventKind[] = ["purchaseDeadline", "allotment", "bbStart", "lockupExpiry", "priceReleaseWatch"];
    expect(payloadsForSubscriber([p], { enabledKinds: v1, watchedCodes: ["A001"] })).toHaveLength(1);
    expect(payloadsForSubscriber([p], { enabledKinds: ["bbStart"], watchedCodes: ["A001"] })).toHaveLength(0);
  });

  it("既存購読（v1 全種別・仮条件追加後の全種別）は初値決定・初決算・即金規制も受け取る", () => {
    const v1: PushEventKind[] = ["purchaseDeadline", "allotment", "bbStart", "lockupExpiry", "priceReleaseWatch"];
    const v2: PushEventKind[] = [...v1, "priceRangeAnnounced", "offeringPriceDecided"];
    for (const kind of ["initialPriceFormed", "earningsAhead", "instantCashRegulation"] as const) {
      const p = { kind, code: "A001", title: "", body: "", url: "" };
      expect(payloadsForSubscriber([p], { enabledKinds: v1, watchedCodes: ["A001"] })).toHaveLength(1);
      expect(payloadsForSubscriber([p], { enabledKinds: v2, watchedCodes: ["A001"] })).toHaveLength(1);
    }
  });
});
