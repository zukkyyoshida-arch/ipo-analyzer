import { describe, it, expect } from "vitest";
import {
  createMemoryKvStore,
  deleteSubscriber,
  hashEndpoint,
  isKnownPushServiceHost,
  listSubscribers,
  MAX_WATCHED_CODES,
  parseStoredRecord,
  parseSubscribeBody,
  parseUnsubscribeBody,
  saveSubscriber,
  SUBSCRIBER_PREFIX,
} from "./subscription";
import { PUSH_EVENT_KINDS } from "./notify";

const NOW = "2026-09-25T00:00:00.000Z";
const SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
};

describe("endpoint のホスト制限", () => {
  it("既知の Push サービス（FCM / Apple / Mozilla / WNS）のみ受け付ける", () => {
    const ok = [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://web.push.apple.com/QAbc/def",
      "https://api.push.apple.com/x",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://foo.push.services.mozilla.com/wpush/v2/abc",
      "https://db5p.notify.windows.com/w/?token=abc",
    ];
    for (const endpoint of ok) {
      expect(parseSubscribeBody({ subscription: { ...SUB, endpoint } }, NOW).ok).toBe(true);
      expect(parseUnsubscribeBody({ endpoint }).ok).toBe(true);
    }
  });

  it("未知ホスト・サフィックス偽装・ポート指定は 400 相当のエラー", () => {
    const bad = [
      "https://example.com/push",
      "https://push.apple.com/x",
      "https://evilpush.apple.com.attacker.example/x",
      "https://fcm.googleapis.com.attacker.example/x",
      "https://notfcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://169.254.169.254/latest",
    ];
    for (const endpoint of bad) {
      const r = parseSubscribeBody({ subscription: { ...SUB, endpoint } }, NOW);
      expect(r).toEqual({ ok: false, error: "endpoint host is not a known push service" });
      expect(parseUnsubscribeBody({ endpoint }).ok).toBe(false);
    }
    expect(isKnownPushServiceHost("WEB.PUSH.APPLE.COM")).toBe(true);
    expect(isKnownPushServiceHost(".push.apple.com")).toBe(false);
  });
});

describe("parseSubscribeBody", () => {
  it("正常な body は既定で全種別・watchedCodes を重複除去して返す", () => {
    const r = parseSubscribeBody({ subscription: SUB, watchedCodes: ["1234", "648A", "1234"] }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.enabledKinds).toEqual(PUSH_EVENT_KINDS);
    expect(r.value.watchedCodes).toEqual(["1234", "648A"]);
    expect(r.value.createdAt).toBe(NOW);
  });

  it("https 以外の endpoint・keys 欠落・未知の種別・不正コード・上限超過は拒否", () => {
    const bad = [
      { subscription: { ...SUB, endpoint: "http://example.com/x" } },
      { subscription: { ...SUB, endpoint: "not a url" } },
      { subscription: { endpoint: SUB.endpoint, keys: { p256dh: SUB.keys.p256dh } } },
      { subscription: { ...SUB, keys: { p256dh: "a b", auth: "x" } } },
      { subscription: SUB, enabledKinds: ["bbStart", "listing"] },
      { subscription: SUB, watchedCodes: ["12345"] },
      { subscription: SUB, watchedCodes: ["abcd"] },
      { subscription: SUB, watchedCodes: Array.from({ length: MAX_WATCHED_CODES + 1 }, (_, i) => String(1000 + i)) },
      null,
      "string",
    ];
    for (const body of bad) {
      expect(parseSubscribeBody(body, NOW).ok).toBe(false);
    }
  });

  it("unsubscribe は https の endpoint のみ受け付ける", () => {
    expect(parseUnsubscribeBody({ endpoint: SUB.endpoint })).toEqual({ ok: true, value: SUB.endpoint });
    expect(parseUnsubscribeBody({ endpoint: "http://x" }).ok).toBe(false);
    expect(parseUnsubscribeBody({}).ok).toBe(false);
  });
});

describe("KV ヘルパ", () => {
  it("キーは sub: + endpoint の SHA-256（16進64文字）", async () => {
    const hash = await hashEndpoint(SUB.endpoint);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashEndpoint(SUB.endpoint)).toBe(hash);
  });

  it("保存→列挙→削除でき、購読以外のキーと壊れたレコードは列挙しない", async () => {
    const kv = createMemoryKvStore({ "state:price-release-watch": "[]", [`${SUBSCRIBER_PREFIX}broken`]: "{" });
    const r = parseSubscribeBody({ subscription: SUB, watchedCodes: ["1234"] }, NOW);
    if (!r.ok) throw new Error(r.error);
    const key = await saveSubscriber(kv, r.value);
    expect(key).toBe(`${SUBSCRIBER_PREFIX}${await hashEndpoint(SUB.endpoint)}`);

    const listed = await listSubscribers(kv);
    expect(listed).toHaveLength(1);
    expect(listed[0].record.watchedCodes).toEqual(["1234"]);

    await deleteSubscriber(kv, SUB.endpoint);
    expect(await listSubscribers(kv)).toEqual([]);
  });

  it("list のページングを最後まで辿る", async () => {
    const r = parseSubscribeBody({ subscription: SUB }, NOW);
    if (!r.ok) throw new Error(r.error);
    const json = JSON.stringify(r.value);
    const pages = [
      { keys: [{ name: "sub:a" }], list_complete: false, cursor: "c1" },
      { keys: [{ name: "sub:b" }], list_complete: true },
    ];
    let call = 0;
    const kv = {
      get: async () => json,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => pages[call++],
    };
    expect((await listSubscribers(kv)).map((s) => s.key)).toEqual(["sub:a", "sub:b"]);
  });

  it("保存済みレコードの未知の種別・不正コードは読み込み時に落とす", () => {
    const rec = parseStoredRecord(
      JSON.stringify({ subscription: SUB, enabledKinds: ["bbStart", "xxx"], watchedCodes: ["1234", "bad"], createdAt: NOW }),
    );
    expect(rec?.enabledKinds).toEqual(["bbStart"]);
    expect(rec?.watchedCodes).toEqual(["1234"]);
    expect(parseStoredRecord(null)).toBeNull();
  });
});
