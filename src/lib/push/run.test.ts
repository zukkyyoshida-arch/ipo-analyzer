import { describe, it, expect } from "vitest";
import type { PushSubscriberRecord } from "@/types/push";
import {
  dryRunPushNotifications,
  jstTodayIso,
  runPushNotifications,
  WATCH_STATE_KEY,
} from "../../../worker/run-push-notifications";
import { bytesToBase64Url } from "./base64url";
import { createMemoryKvStore, saveSubscriber, subscriberKey } from "./subscription";
import { PUSH_EVENT_KINDS } from "./notify";
import { generateVapidKeys } from "./vapid";
import { baseIpo } from "./fixtures.test-helper";

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
});
