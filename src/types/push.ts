// Web Push（VAPID）購読・通知の型定義。購読情報は Cloudflare KV（PUSH_SUBSCRIPTIONS）に保存する。

/** PushSubscription.toJSON() の必要部分。 */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushEventKind =
  | "bbStart"
  | "allotment"
  | "purchaseDeadline"
  | "lockupExpiry"
  | "priceReleaseWatch"
  | "priceRangeAnnounced"
  | "offeringPriceDecided";

export interface PushSubscriberRecord {
  subscription: PushSubscriptionJson;
  /** 通知を受け取るイベント種別。既定は全種別。 */
  enabledKinds: PushEventKind[];
  /**
   * 通知対象の銘柄コード（v1 はウォッチリストの銘柄のみ・固定）。
   * クライアントがウォッチリストの全コードを送る。空配列なら通知は届かない。
   */
  watchedCodes: string[];
  createdAt: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  kind: PushEventKind;
  code: string;
}
