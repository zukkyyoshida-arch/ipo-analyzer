import type {
  PushEventKind,
  PushSubscriberRecord,
  PushSubscriptionJson,
} from "@/types/push";
import { PUSH_EVENT_KINDS } from "./notify";

// 購読情報の KV 読み書きと入力検証。KV は PushKvStore（KVNamespace の必要部分）として受け取り、
// テストではメモリ実装を注入できるようにする。

/** KVNamespace のうち使う部分だけの型（@cloudflare/workers-types に依存しない）。 */
export interface PushKvStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** 購読レコードのキー接頭辞（通知状態などの別キーと区別する）。 */
export const SUBSCRIBER_PREFIX = "sub:";
export const MAX_WATCHED_CODES = 200;
const CODE_PATTERN = /^[0-9A-Z]{4}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_ENDPOINT_LENGTH = 2048;

/** 購読 endpoint として受け付ける Push サービスのホスト（完全一致）。 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
/** 購読 endpoint として受け付ける Push サービスのホスト（サブドメイン。例: web.push.apple.com）。 */
const PUSH_SERVICE_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"];

/** endpoint のホストが既知の Push サービス（FCM / Apple / Mozilla / WNS）か。任意 URL への送信（SSRF）を防ぐ。 */
export function isKnownPushServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}

/** endpoint の SHA-256（16進）。 */
export async function hashEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function subscriberKey(endpoint: string): Promise<string> {
  return `${SUBSCRIBER_PREFIX}${await hashEndpoint(endpoint)}`;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param requireKnownHost true なら既知の Push サービス以外のホストを拒否する（外部からの入力）。
 *   KV に保存済みのレコード（保存時に検証済み）の読み込みでは false。
 */
function validateEndpoint(value: unknown, requireKnownHost = true): ValidationResult<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, error: "endpoint is required" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "endpoint is not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "endpoint must be https" };
  }
  if (requireKnownHost && (url.port !== "" || !isKnownPushServiceHost(url.hostname))) {
    return { ok: false, error: "endpoint host is not a known push service" };
  }
  return { ok: true, value };
}

function validateKeyString(value: unknown, name: string): ValidationResult<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return { ok: false, error: `keys.${name} is required` };
  }
  if (!BASE64URL_PATTERN.test(value)) {
    return { ok: false, error: `keys.${name} must be base64url` };
  }
  return { ok: true, value };
}

export function validateSubscription(
  value: unknown,
  requireKnownHost = true,
): ValidationResult<PushSubscriptionJson> {
  if (!isRecord(value)) return { ok: false, error: "subscription is required" };
  const endpoint = validateEndpoint(value.endpoint, requireKnownHost);
  if (!endpoint.ok) return endpoint;
  if (!isRecord(value.keys)) return { ok: false, error: "keys is required" };
  const p256dh = validateKeyString(value.keys.p256dh, "p256dh");
  if (!p256dh.ok) return p256dh;
  const auth = validateKeyString(value.keys.auth, "auth");
  if (!auth.ok) return auth;
  return {
    ok: true,
    value: { endpoint: endpoint.value, keys: { p256dh: p256dh.value, auth: auth.value } },
  };
}

/**
 * POST /api/push/subscribe の body を検証して購読レコードにする。
 * body: { subscription: {endpoint, keys:{p256dh,auth}}, enabledKinds?: PushEventKind[], watchedCodes?: string[] }
 * @param nowIso createdAt に入れる時刻（呼び出し側が渡す）
 */
export function parseSubscribeBody(
  body: unknown,
  nowIso: string,
): ValidationResult<PushSubscriberRecord> {
  if (!isRecord(body)) return { ok: false, error: "invalid body" };
  const subscription = validateSubscription(body.subscription);
  if (!subscription.ok) return subscription;

  let enabledKinds: PushEventKind[] = [...PUSH_EVENT_KINDS];
  if (body.enabledKinds !== undefined) {
    if (!Array.isArray(body.enabledKinds)) return { ok: false, error: "enabledKinds must be an array" };
    const allowed = new Set<string>(PUSH_EVENT_KINDS);
    for (const kind of body.enabledKinds) {
      if (typeof kind !== "string" || !allowed.has(kind)) {
        return { ok: false, error: "enabledKinds contains an unknown kind" };
      }
    }
    enabledKinds = PUSH_EVENT_KINDS.filter((k) => (body.enabledKinds as string[]).includes(k));
  }

  let watchedCodes: string[] = [];
  if (body.watchedCodes !== undefined) {
    if (!Array.isArray(body.watchedCodes)) return { ok: false, error: "watchedCodes must be an array" };
    if (body.watchedCodes.length > MAX_WATCHED_CODES) {
      return { ok: false, error: `watchedCodes must be at most ${MAX_WATCHED_CODES}` };
    }
    for (const code of body.watchedCodes) {
      if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
        return { ok: false, error: "watchedCodes contains an invalid code" };
      }
    }
    watchedCodes = Array.from(new Set(body.watchedCodes as string[]));
  }

  return {
    ok: true,
    value: { subscription: subscription.value, enabledKinds, watchedCodes, createdAt: nowIso },
  };
}

/** POST /api/push/unsubscribe の body（{ endpoint }）を検証する。 */
export function parseUnsubscribeBody(body: unknown): ValidationResult<string> {
  if (!isRecord(body)) return { ok: false, error: "invalid body" };
  return validateEndpoint(body.endpoint);
}

/** KV から読んだ JSON を購読レコードとして解釈する。壊れていれば null。 */
export function parseStoredRecord(raw: string | null): PushSubscriberRecord | null {
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    const subscription = validateSubscription(data.subscription, false);
    if (!subscription.ok) return null;
    const allowed = new Set<string>(PUSH_EVENT_KINDS);
    const enabledKinds = Array.isArray(data.enabledKinds)
      ? (data.enabledKinds.filter((k) => typeof k === "string" && allowed.has(k)) as PushEventKind[])
      : [...PUSH_EVENT_KINDS];
    const watchedCodes = Array.isArray(data.watchedCodes)
      ? (data.watchedCodes.filter((c) => typeof c === "string" && CODE_PATTERN.test(c)) as string[])
      : [];
    const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
    return { subscription: subscription.value, enabledKinds, watchedCodes, createdAt };
  } catch {
    return null;
  }
}

/** 購読を保存（同じ endpoint は上書き＝設定の更新）。保存したキーを返す。 */
export async function saveSubscriber(
  kv: PushKvStore,
  record: PushSubscriberRecord,
): Promise<string> {
  const key = await subscriberKey(record.subscription.endpoint);
  await kv.put(key, JSON.stringify(record));
  return key;
}

export async function deleteSubscriber(kv: PushKvStore, endpoint: string): Promise<void> {
  await kv.delete(await subscriberKey(endpoint));
}

export interface StoredSubscriber {
  key: string;
  record: PushSubscriberRecord;
}

/** 全購読者を列挙する（KV の list はページング。壊れたレコードは読み飛ばす）。 */
export async function listSubscribers(kv: PushKvStore): Promise<StoredSubscriber[]> {
  const result: StoredSubscriber[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: SUBSCRIBER_PREFIX, cursor });
    for (const { name } of page.keys) {
      const record = parseStoredRecord(await kv.get(name, "text"));
      if (record) result.push({ key: name, record });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return result;
}

/** テスト・ドライラン用のメモリ実装。 */
export function createMemoryKvStore(initial: Record<string, string> = {}): PushKvStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    async list(options = {}) {
      const keys = Array.from(data.keys())
        .filter((k) => !options.prefix || k.startsWith(options.prefix))
        .sort()
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}
