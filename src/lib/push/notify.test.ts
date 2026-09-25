import { describe, it, expect } from "vitest";
import type { CalendarEvent, CalendarEventKind } from "@/lib/events";
import type { Ipo } from "@/types/ipo";
import type { PushEventKind } from "@/types/push";
import {
  buildPayload,
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

  it("対象外の種別（上場・初決算・大量保有・BB締切）は通知しない", () => {
    const a = baseIpo({ code: "A001" });
    const payloads = selectNotifiableEvents(
      [
        ev(a, "listing", "2026-09-26"),
        ev(a, "firstEarnings", "2026-09-26"),
        ev(a, "largeHoldingReport", TODAY),
        ev(a, "bbEnd", "2026-09-26"),
      ],
      TODAY,
    );
    expect(payloads).toEqual([]);
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
