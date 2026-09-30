import { describe, expect, it } from "vitest";
import { createMemoryKvStore, listSubscribers, SUBSCRIBER_PREFIX } from "@/lib/push/subscription";
import { PRICE_SNAPSHOT_KEY, WATCH_STATE_KEY } from "../../../worker/run-push-notifications";
import { emptyHoldingsFile } from "./file";
import {
  buildHoldingsIssuersFile,
  emptyIntradayState,
  HOLDINGS_INTRADAY_PREFIX,
  intradayHoldingsKey,
  mergeIntradayHoldings,
  parseHoldingsIssuersFile,
  parseIntradayState,
  type IntradayHoldingsState,
} from "./intraday";
import { readIntradayHoldingsStates } from "./intradayStore";
import type { HoldingItem, HoldingsFile } from "./types";

function item(p: Partial<HoldingItem> & { docId: string }): HoldingItem {
  return {
    code: "4436",
    name: "ミンカブ",
    submitDate: "2026-09-30",
    filer: "提出者",
    formType: "change",
    ratio: 0.07,
    prevRatio: 0.05,
    delta: 0.02,
    purpose: "純投資",
    shares: 1000,
    reason: "",
    obligationDate: "",
    ...p,
  };
}

function file(items: HoldingItem[], coveredThrough = "2026-09-29"): HoldingsFile {
  return { ...emptyHoldingsFile(), generatedAt: "x", coveredFrom: "2026-04-03", coveredThrough, items };
}

function state(date: string, p: Partial<IntradayHoldingsState> = {}): IntradayHoldingsState {
  return { ...emptyIntradayState(date), fetchedAt: `${date}T03:00:00.000Z`, ...p };
}

describe("KV キー", () => {
  it("購読・通知状態のキーと接頭辞が重ならない", () => {
    const key = intradayHoldingsKey("2026-09-30");
    expect(key).toBe("holdings:intraday:2026-09-30");
    expect(key.startsWith(SUBSCRIBER_PREFIX)).toBe(false);
    for (const other of [SUBSCRIBER_PREFIX, WATCH_STATE_KEY, PRICE_SNAPSHOT_KEY]) {
      expect(other.startsWith(HOLDINGS_INTRADAY_PREFIX)).toBe(false);
    }
  });

  it("日中取得分を置いても購読の列挙に混ざらない", async () => {
    const kv = createMemoryKvStore({
      [intradayHoldingsKey("2026-09-30")]: JSON.stringify(state("2026-09-30")),
    });
    expect(await listSubscribers(kv)).toEqual([]);
  });
});

describe("parseIntradayState", () => {
  it("無い・壊れている・日付が違うときは null", () => {
    expect(parseIntradayState(null, "2026-09-30")).toBeNull();
    expect(parseIntradayState("{ broken", "2026-09-30")).toBeNull();
    expect(parseIntradayState(JSON.stringify(state("2026-09-29")), "2026-09-30")).toBeNull();
  });

  it("形の崩れた行は落とす", () => {
    const raw = JSON.stringify({ ...state("2026-09-30"), items: [item({ docId: "S1" }), { docId: "" }], deferred: 2 });
    const s = parseIntradayState(raw, "2026-09-30");
    expect(s?.items.map((i) => i.docId)).toEqual(["S1"]);
    expect(s?.deferred).toBe(2);
  });
});

describe("mergeIntradayHoldings", () => {
  it("日中分が無ければそのまま返す", () => {
    const f = file([item({ docId: "A", submitDate: "2026-09-29" })]);
    expect(mergeIntradayHoldings(f, [])).toBe(f);
    expect(mergeIntradayHoldings(null, [])).toBeNull();
  });

  it("当日分を足し、docID の重複は holdings.json 側を残す", () => {
    const f = file([item({ docId: "A", submitDate: "2026-09-29", filer: "夜間" })]);
    const merged = mergeIntradayHoldings(f, [
      state("2026-09-30", { items: [item({ docId: "B" }), item({ docId: "A", filer: "日中" })] }),
    ]);
    expect(merged?.items.map((i) => i.docId)).toEqual(["B", "A"]);
    expect(merged?.items.find((i) => i.docId === "A")?.filer).toBe("夜間");
    expect(merged?.intradayFetchedAt).toBe("2026-09-30T03:00:00.000Z");
    expect(merged?.coveredThrough).toBe("2026-09-29");
  });

  it("夜間が取り終えた日（coveredThrough 以前）の日中分は使わない", () => {
    const merged = mergeIntradayHoldings(file([], "2026-09-30"), [state("2026-09-30", { items: [item({ docId: "B" })] })]);
    expect(merged?.items).toEqual([]);
    expect(merged?.intradayFetchedAt).toBeUndefined();
  });

  it("取下げは holdings.json 側からも消す", () => {
    const f = file([item({ docId: "A", submitDate: "2026-09-29" })]);
    const merged = mergeIntradayHoldings(f, [state("2026-09-30", { withdrawnDocIds: ["A"] })]);
    expect(merged?.items).toEqual([]);
  });

  it("訂正は訂正前の種類・提出日を引き継いで置き換える", () => {
    const f = file([item({ docId: "A", submitDate: "2026-09-25", formType: "new" })]);
    const merged = mergeIntradayHoldings(f, [
      state("2026-09-30", { items: [item({ docId: "C", amendedFrom: "A", formType: "change" })] }),
    ]);
    expect(merged?.items).toHaveLength(1);
    expect(merged?.items[0]).toMatchObject({ docId: "C", formType: "new", submitDate: "2026-09-25", amendedFrom: "A" });
  });

  it("holdings.json が無くても日中分だけで作る", () => {
    const merged = mergeIntradayHoldings(null, [state("2026-09-30", { items: [item({ docId: "B" })] })]);
    expect(merged?.items.map((i) => i.docId)).toEqual(["B"]);
  });
});

describe("readIntradayHoldingsStates", () => {
  it("KV が無ければ空", async () => {
    expect(await readIntradayHoldingsStates(null, "2026-09-30")).toEqual([]);
  });

  it("直近 3 日分のキーだけ読む", async () => {
    const kv = createMemoryKvStore({
      [intradayHoldingsKey("2026-09-30")]: JSON.stringify(state("2026-09-30")),
      [intradayHoldingsKey("2026-09-28")]: JSON.stringify(state("2026-09-28")),
      [intradayHoldingsKey("2026-09-27")]: JSON.stringify(state("2026-09-27")),
    });
    const states = await readIntradayHoldingsStates(kv, "2026-09-30");
    expect(states.map((s) => s.date)).toEqual(["2026-09-30", "2026-09-28"]);
  });
});

describe("holdings-issuers.json", () => {
  it("IPO 銘柄の分だけ書き出し、読み戻せる", () => {
    const universe = new Map([["4436", { code: "4436", name: "ミンカブ", listingDate: "2019-12-19" }]]);
    const codeMap = new Map([
      ["E34754", "4436"],
      ["E99999", "9999"],
    ]);
    const f = buildHoldingsIssuersFile(universe, codeMap, new Date("2026-09-30T00:00:00Z"));
    expect(f.items).toEqual([{ edinetCode: "E34754", code: "4436", name: "ミンカブ", listingDate: "2019-12-19" }]);
    expect(parseHoldingsIssuersFile(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseHoldingsIssuersFile({ items: [{ edinetCode: "bad", code: "1" }] })?.items).toEqual([]);
    expect(parseHoldingsIssuersFile(null)).toBeNull();
  });
});
