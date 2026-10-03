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
  | "offeringPriceDecided"
  /** 上場日（初値持ち越し中は翌日以降も）に初値が付いた。 */
  | "initialPriceFormed"
  /** 上場後最初の決算発表の 3 日前・前日。 */
  | "earningsAhead"
  /** 上場初日に初値が付かず、翌日が即金規制になる可能性。 */
  | "instantCashRegulation"
  /** 中長期セカンダリで新たに −60% に届いた銘柄（ウォッチ外も対象）。 */
  | "midCandidateNew";

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
