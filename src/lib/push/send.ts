import type { PushNotificationPayload, PushSubscriptionJson } from "@/types/push";
import { utf8, type Bytes } from "./base64url";
import { encryptAes128gcm } from "./encrypt";
import { vapidAuthorization, type VapidKeys } from "./vapid";

// 送信層: 暗号化済み本文と VAPID ヘッダを組み立てて fetch する。通知の選定（notify.ts）とは分離。

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Bytes;
}

export interface BuildPushRequestInput {
  subscription: PushSubscriptionJson;
  payload: PushNotificationPayload;
  vapid: VapidKeys;
  /** 現在時刻（UNIX 秒）。 */
  nowSeconds: number;
  /** プッシュサービスでの保持秒数（既定 12 時間。当日の予定なので長く残さない）。 */
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

/** Topic ヘッダ（同じ銘柄・種別の未配信通知を置き換える）。base64url 文字のみ・32文字以内。 */
export function pushTopic(payload: PushNotificationPayload): string {
  return `${payload.kind}-${payload.code}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

export async function buildPushRequest(input: BuildPushRequestInput): Promise<PushRequest> {
  const { subscription, payload, vapid, nowSeconds } = input;
  const body = await encryptAes128gcm(utf8(JSON.stringify(payload)), subscription.keys);
  const authorization = await vapidAuthorization(subscription.endpoint, vapid, nowSeconds);
  return {
    endpoint: subscription.endpoint,
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
      Urgency: input.urgency ?? "normal",
      Topic: pushTopic(payload),
    },
    body,
  };
}

export interface SendResult {
  status: number;
  ok: boolean;
  /** 404/410: 購読が失効している（KV から削除する）。 */
  expired: boolean;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function sendPushRequest(
  request: PushRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  const res = await fetchImpl(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  return {
    status: res.status,
    ok: res.ok,
    expired: res.status === 404 || res.status === 410,
  };
}
