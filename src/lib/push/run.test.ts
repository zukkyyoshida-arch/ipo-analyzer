import { describe, it, expect } from "vitest";
import type { PushSubscriberRecord } from "@/types/push";
import {
  dryRunPushNotifications,
  jstTodayIso,
  runInitialPriceWatch,
  runInstantCashCheck,
  runPushNotifications,
  INITIAL_PRICE_STATE_KEY,
  MID_CANDIDATE_STATE_KEY,
  PRICE_SNAPSHOT_KEY,
  WATCH_STATE_KEY,
  type QuoteFetcher,
} from "../../../worker/run-push-notifications";
import { CRON_JOBS, jobForCron } from "../../../worker/cron-jobs";
import type { DailyBar } from "./initialPrice";
import { bytesToBase64Url } from "./base64url";
import { createMemoryKvStore, saveSubscriber, subscriberKey } from "./subscription";
import { PUSH_EVENT_KINDS } from "./notify";
import { generateVapidKeys } from "./vapid";
import { baseIpo, midFile, midItem } from "./fixtures.test-helper";

// Cron 本体（worker/run-push-notifications.ts）の結合テスト。KV はメモリ実装、fetch はモック。

const NOW = new Date("2026-09-24T23:00:00Z"); // JST 2026-09-25 08:00

async function subscriber(endpoint: string, watchedCodes: string[]): Promise<PushSubscriberRecord> {
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  return {
    subscription: {
      endpoint,
      keys: { p256dh: bytesToBase64Url(raw), auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))) },
    },
    enabledKinds: [...PUSH_EVENT_KINDS],
    watchedCodes,
    createdAt: NOW.toISOString(),
  };
}

const IPOS = [
  baseIpo({ code: "A001", name: "明日BB", bbPeriod: { start: "2026-09-26", end: "2026-10-01" } }),
  baseIpo({ code: "B002", name: "本日期限", purchasePeriod: { start: "2026-09-22", end: "2026-09-25" } }),
  baseIpo({ code: "C003", name: "対象外", listingDate: "2026-09-26" }),
];
const loadIpos = async () => IPOS;

describe("runPushNotifications", () => {
  it("JST の今日を UTC 23:00 起動から正しく求める", () => {
    expect(jstTodayIso(NOW)).toBe("2026-09-25");
    expect(jstTodayIso(new Date("2026-09-25T14:59:59Z"))).toBe("2026-09-25");
    expect(jstTodayIso(new Date("2026-09-25T15:00:00Z"))).toBe("2026-09-26");
  });

  it("ドライランは送信・KV 書き込みをせず件数だけ返す", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/a", ["A001", "B002"]));
    await saveSubscriber(kv, await subscriber("https://push.example.com/b", []));
    let fetched = 0;
    const summary = await dryRunPushNotifications(
      { PUSH_SUBSCRIPTIONS: kv },
      { now: NOW, loadIpos, fetchImpl: async () => { fetched++; return new Response(null, { status: 201 }); }, log: () => {} },
    );
    expect(summary).toMatchObject({ todayIso: "2026-09-25", dryRun: true, subscribers: 2, candidates: 2, planned: 2, sent: 0 });
    expect(fetched).toBe(0);
    expect(kv.data.has(WATCH_STATE_KEY)).toBe(false);
  });

  it("aes128gcm＋VAPID で送信し、410 の購読は KV から削除する", async () => {
    const vapid = await generateVapidKeys();
    const kv = createMemoryKvStore();
    const alive = await subscriber("https://push.example.com/alive", ["A001", "B002"]);
    const gone = await subscriber("https://push.example.com/gone", ["A001"]);
    await saveSubscriber(kv, alive);
    await saveSubscriber(kv, gone);

    const calls: { url: string; headers: Record<string, string> }[] = [];
    const summary = await runPushNotifications(
      {
        PUSH_SUBSCRIPTIONS: kv,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:test@example.com",
      },
      {
        now: NOW,
        loadIpos,
        log: () => {},
        fetchImpl: async (url, init) => {
          calls.push({ url, headers: init.headers as Record<string, string> });
          return new Response(null, { status: url.endsWith("/gone") ? 410 : 201 });
        },
      },
    );

    expect(summary).toMatchObject({ subscribers: 2, planned: 3, sent: 2, failed: 1, removed: 1 });
    expect(calls[0].headers["Content-Encoding"]).toBe("aes128gcm");
    expect(calls[0].headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(await kv.get(await subscriberKey(gone.subscription.endpoint), "text")).toBeNull();
    expect(await kv.get(await subscriberKey(alive.subscription.endpoint), "text")).not.toBeNull();
    expect(kv.data.get(WATCH_STATE_KEY)).toBe("[]");
  });

  it("KV が無ければ何もしない", async () => {
    const summary = await runPushNotifications({}, { now: NOW, loadIpos, log: () => {} });
    expect(summary).toMatchObject({ subscribers: 0, candidates: 0, sent: 0 });
  });

  it("価格スナップショットを保存し、次回は仮条件発表を差分で候補に入れる（初回は通知しない）", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/p", ["P001"]));
    const after = [baseIpo({ code: "P001", name: "価格", assumedPrice: 1000, priceRange: { low: 1100, high: 1200 }, offeringPrice: null })];

    const first = await runPushNotifications({ PUSH_SUBSCRIPTIONS: kv }, { now: NOW, loadIpos: async () => after, log: () => {} });
    expect(first.candidates).toBe(0);
    expect(JSON.parse(kv.data.get(PRICE_SNAPSHOT_KEY) as string)).toHaveLength(1);

    await kv.put(PRICE_SNAPSHOT_KEY, JSON.stringify([{ code: "P001", name: "価格", assumedPrice: 1000, priceRange: null, offeringPrice: null }]));
    const second = await dryRunPushNotifications({ PUSH_SUBSCRIPTIONS: kv }, { now: NOW, loadIpos: async () => after, log: () => {} });
    expect(second).toMatchObject({ candidates: 1, planned: 1 });
  });
});

describe("runPushNotifications: 中長期の新規候補", () => {
  it("初回は送らず状態だけ保存し、2 回目は新規をウォッチ外の購読者にも送る", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/m", []));
    const first = midFile([midItem("1111")]);
    const r1 = await runPushNotifications({ PUSH_SUBSCRIPTIONS: kv }, { now: NOW, loadIpos: async () => [], loadMidFile: async () => first, log: () => {} });
    expect(r1.candidates).toBe(0);
    expect(JSON.parse(kv.data.get(MID_CANDIDATE_STATE_KEY) as string)).toEqual(["1111"]);

    const second = midFile([midItem("1111"), midItem("2222")]);
    const r2 = await dryRunPushNotifications({ PUSH_SUBSCRIPTIONS: kv }, { now: NOW, loadIpos: async () => [], loadMidFile: async () => second, log: () => {} });
    expect(r2).toMatchObject({ candidates: 1, planned: 1 });
    // ドライランは状態を書かない。
    expect(JSON.parse(kv.data.get(MID_CANDIDATE_STATE_KEY) as string)).toEqual(["1111"]);
  });

  it("midterm.json の読込に失敗しても他の通知は送る", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/e", ["A001"]));
    const r = await dryRunPushNotifications(
      { PUSH_SUBSCRIPTIONS: kv },
      { now: NOW, loadIpos, loadMidFile: async () => { throw new Error("boom"); }, log: () => {} },
    );
    expect(r).toMatchObject({ candidates: 2, planned: 1 });
  });
});

// ---- 初値決定・即金規制（当日上場銘柄だけ quote を取る） ----

const LISTING_NOW = new Date("2026-10-01T01:10:00Z"); // JST 2026-10-01 10:10
const LISTING_DAY = "2026-10-01";
const LISTING_IPOS = [
  baseIpo({ code: "N001", name: "当日上場", listingDate: LISTING_DAY, offeringPrice: 1000 }),
  baseIpo({ code: "N002", name: "気配のまま", listingDate: LISTING_DAY, offeringPrice: 2000 }),
  baseIpo({ code: "N003", name: "上場済", listingDate: "2026-09-10", initialPrice: 1500 }),
];

function quoteMock(bars: Record<string, DailyBar[] | null>) {
  const called: string[] = [];
  const fetchQuote: QuoteFetcher = async (code) => {
    called.push(code);
    return bars[code] ?? null;
  };
  return { called, fetchQuote };
}

async function vapidEnv(kv: ReturnType<typeof createMemoryKvStore>) {
  const vapid = await generateVapidKeys();
  return {
    PUSH_SUBSCRIPTIONS: kv,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:test@example.com",
  };
}

const noForecast = async () => ({ history: [], enriched: [] });

describe("runInitialPriceWatch", () => {
  it("当日上場が無ければ quote を叩かず、購読も読まない", async () => {
    const kv = createMemoryKvStore();
    const { called, fetchQuote } = quoteMock({});
    const summary = await runInitialPriceWatch(
      { PUSH_SUBSCRIPTIONS: kv },
      { now: LISTING_NOW, loadIpos: async () => [LISTING_IPOS[2]], fetchQuote, log: () => {} },
    );
    expect(called).toEqual([]);
    expect(summary).toMatchObject({ quotes: 0, candidates: 0, subscribers: 0 });
  });

  it("初値の成立を検知して 1 回だけ送り、次の回は同じ銘柄の quote を取らない", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/n", ["N001", "N002"]));
    const env = await vapidEnv(kv);
    const bodies: number[] = [];
    const { called, fetchQuote } = quoteMock({
      N001: [{ date: LISTING_DAY, open: 1800, close: 1750, volume: 500000 }],
      N002: [],
    });
    const opts = {
      now: LISTING_NOW,
      loadIpos: async () => LISTING_IPOS,
      fetchQuote,
      loadForecastInputs: noForecast,
      log: () => {},
      fetchImpl: async (_url: string, init: RequestInit) => {
        bodies.push((init.body as Uint8Array).byteLength);
        return new Response(null, { status: 201 });
      },
    };

    const first = await runInitialPriceWatch(env, opts);
    expect(called).toEqual(["N001", "N002"]);
    expect(first).toMatchObject({ quotes: 2, candidates: 1, planned: 1, sent: 1 });
    expect(JSON.parse(kv.data.get(INITIAL_PRICE_STATE_KEY) as string).formed).toEqual({
      N001: { date: LISTING_DAY, price: 1800 },
    });

    called.length = 0;
    const second = await runInitialPriceWatch(env, opts);
    expect(called).toEqual(["N002"]);
    expect(second).toMatchObject({ quotes: 1, candidates: 0, sent: 0 });
    expect(bodies).toHaveLength(1);
  });

  it("ドライランは状態を書かない", async () => {
    const kv = createMemoryKvStore();
    const { fetchQuote } = quoteMock({ N001: [{ date: LISTING_DAY, open: 1800, close: 1750, volume: 1 }] });
    const summary = await runInitialPriceWatch(
      { PUSH_SUBSCRIPTIONS: kv },
      { now: LISTING_NOW, dryRun: true, loadIpos: async () => LISTING_IPOS, fetchQuote, loadForecastInputs: noForecast, log: () => {} },
    );
    expect(summary.candidates).toBe(1);
    expect(kv.data.has(INITIAL_PRICE_STATE_KEY)).toBe(false);
  });
});

describe("runInstantCashCheck", () => {
  const CLOSE_NOW = new Date("2026-10-01T06:45:00Z"); // JST 15:45

  it("初値が付かなかった銘柄にだけ送り、付いた銘柄は成立として記録する。2 回目は送らない", async () => {
    const kv = createMemoryKvStore();
    await saveSubscriber(kv, await subscriber("https://push.example.com/c", ["N001", "N002"]));
    const env = await vapidEnv(kv);
    const { called, fetchQuote } = quoteMock({
      N001: [{ date: LISTING_DAY, open: 1800, close: 1750, volume: 500000 }],
      N002: [{ date: LISTING_DAY, open: 4600, close: 4600, volume: 0 }],
    });
    const opts = {
      now: CLOSE_NOW,
      loadIpos: async () => LISTING_IPOS,
      fetchQuote,
      log: () => {},
      fetchImpl: async () => new Response(null, { status: 201 }),
    };

    const first = await runInstantCashCheck(env, opts);
    expect(called).toEqual(["N001", "N002"]);
    expect(first).toMatchObject({ candidates: 1, planned: 1, sent: 1 });
    const state = JSON.parse(kv.data.get(INITIAL_PRICE_STATE_KEY) as string);
    expect(state.instantCash).toEqual({ N002: LISTING_DAY });
    expect(state.formed.N001.price).toBe(1800);

    called.length = 0;
    const second = await runInstantCashCheck(env, opts);
    expect(called).toEqual([]);
    expect(second).toMatchObject({ quotes: 0, sent: 0 });
  });

  it("quote が取れない銘柄は判定できないので送らない", async () => {
    const kv = createMemoryKvStore();
    const { fetchQuote } = quoteMock({ N001: null, N002: null });
    const summary = await runInstantCashCheck(
      { PUSH_SUBSCRIPTIONS: kv },
      { now: CLOSE_NOW, loadIpos: async () => LISTING_IPOS, fetchQuote, log: () => {} },
    );
    expect(summary).toMatchObject({ quotes: 2, candidates: 0 });
  });
});

describe("Cron の振り分け", () => {
  it("wrangler.jsonc の 3 本をそれぞれの処理へ振り分け、未知の Cron は null", () => {
    expect(jobForCron("0 23 * * *")).toBe(runPushNotifications);
    expect(jobForCron("*/10 0-6 * * MON-FRI")).toBe(runInitialPriceWatch);
    expect(jobForCron("45 6 * * MON-FRI")).toBe(runInstantCashCheck);
    expect(jobForCron("* * * * *")).toBeNull();
    expect(jobForCron("toString")).toBeNull();
  });

  it("表のキーは wrangler.jsonc の triggers.crons と一致する", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const text = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    const m = text.match(/"crons":\s*(\[[^\]]*\])/);
    expect(m).not.toBeNull();
    expect(new Set(JSON.parse(m![1]) as string[])).toEqual(new Set(Object.keys(CRON_JOBS)));
  });
});
