import type { Ipo } from "@/types/ipo";
import type { PushEventKind, PushNotificationPayload, PushSubscriberRecord } from "@/types/push";
import type { CalendarEvent } from "@/lib/events";
import { daysBetween } from "@/lib/date";
import { formatDate } from "@/lib/format";

// プッシュ通知の対象選定と文面組み立て（純関数）。送信層（send.ts）とは分離する。
// 「今日」は呼び出し側（Cron）が JST で計算して todayIso として渡す。

export const PUSH_EVENT_KINDS: PushEventKind[] = [
  "purchaseDeadline",
  "allotment",
  "bbStart",
  "lockupExpiry",
  "priceReleaseWatch",
];

export const PUSH_EVENT_LABELS: Record<PushEventKind, string> = {
  bbStart: "明日BB開始",
  allotment: "明日抽選",
  purchaseDeadline: "本日購入期限",
  lockupExpiry: "ロックアップ解除（3日前・当日）",
  priceReleaseWatch: "1.5倍ライン監視",
};

/** ロックアップ解除を何日前に予告するか（予告はこの日と当日の2回だけ。毎日連続では鳴らさない）。 */
export const LOCKUP_NOTICE_DAYS = 3;
/** 1購読者あたり1回の Cron で送る上限（通知の出しすぎを防ぐ）。 */
export const MAX_NOTIFICATIONS_PER_SUBSCRIBER = 5;

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

function heading(label: string, ipo: Ipo): string {
  return `${label}：${ipo.name}（${ipo.code}）`;
}

export interface BuildPayloadOptions {
  /** イベント日（YYYY-MM-DD）。省略時は銘柄の日程から補う。 */
  date?: string;
  /** lockupExpiry: 解除日までの日数（0 = 本日）。 */
  daysUntil?: number;
}

/** 通知1件分の文面を作る。文言は参考情報に限定し、売買の判断を促す表現は使わない。 */
export function buildPayload(
  kind: PushEventKind,
  ipo: Ipo,
  options: BuildPayloadOptions = {},
): PushNotificationPayload {
  const url = `/ipo/${ipo.code}`;
  const base = { url, kind, code: ipo.code };

  switch (kind) {
    case "bbStart": {
      const start = options.date ?? ipo.bbPeriod.start;
      const range = ipo.bbPeriod.end
        ? `（${formatDate(start)}〜${formatDate(ipo.bbPeriod.end)}）`
        : "";
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.bbStart, ipo),
        body: `ブックビルディング期間が明日${shortDate(start)}から始まります${range}。条件は銘柄ページで確認できます。`,
      };
    }
    case "allotment": {
      const date = options.date ?? ipo.allotmentDate;
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.allotment, ipo),
        body: `明日${shortDate(date)}は公開価格決定・抽選日です。`,
      };
    }
    case "purchaseDeadline": {
      const date = options.date ?? ipo.purchasePeriod.end;
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.purchaseDeadline, ipo),
        body: `当選分の購入申込期限は本日${shortDate(date)}です。`,
      };
    }
    case "lockupExpiry": {
      const days = options.daysUntil;
      const label =
        days === undefined
          ? "ロックアップ解除予定"
          : days <= 0
            ? "本日ロックアップ解除"
            : `ロックアップ解除まで${days}日`;
      const when = options.date ? `${shortDate(options.date)}に` : "";
      return {
        ...base,
        title: heading(label, ipo),
        body: `上場日から${ipo.lockup.days}日のロックアップ期間が${when}終了します（参考情報）。`,
      };
    }
    case "priceReleaseWatch": {
      const offering = ipo.offeringPrice;
      const current = ipo.currentPrice;
      const ratio =
        offering !== null && offering > 0 && current !== null && current !== undefined
          ? `公開価格の${(current / offering).toFixed(2)}倍`
          : "公開価格の1.4倍以上";
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.priceReleaseWatch, ipo),
        body: `直近終値が${ratio}です。1.5倍解除条項の対象株があります（参考情報）。`,
      };
    }
  }
}

export interface SelectOptions {
  /**
   * 前回の Cron で 1.5倍ライン監視に入っていた銘柄コード。指定すると「新規に監視圏へ入った銘柄」だけ通知する
   * （毎日同じ通知が届くのを防ぐ）。省略時は監視中の全銘柄。
   */
  previousWatchCodes?: readonly string[];
}

/**
 * 横断イベント一覧（upcomingCalendarEvents の結果）から通知対象を抽出する。
 * - 明日BB開始（bbStart が today+1）／明日抽選（allotment が today+1）
 * - 本日購入期限（purchaseEnd が today）
 * - ロックアップ解除（lockupExpiry が today+3 の予告と today の当日の2回のみ）
 * - 1.5倍ライン監視（priceReleaseWatch が today。previousWatchCodes 指定時は新規のみ）
 * 同じ銘柄×種別は1件にまとめ、種別の優先順→銘柄コード順で返す。
 */
export function selectNotifiableEvents(
  events: CalendarEvent[],
  todayIso: string,
  options: SelectOptions = {},
): PushNotificationPayload[] {
  const previous = options.previousWatchCodes ? new Set(options.previousWatchCodes) : null;
  const seen = new Set<string>();
  const payloads: PushNotificationPayload[] = [];

  function push(kind: PushEventKind, event: CalendarEvent, extra: BuildPayloadOptions = {}) {
    const id = `${kind}:${event.ipo.code}`;
    if (seen.has(id)) return;
    seen.add(id);
    payloads.push(buildPayload(kind, event.ipo, { date: event.date, ...extra }));
  }

  for (const event of events) {
    const diff = daysBetween(todayIso, event.date);
    if (!Number.isFinite(diff)) continue;
    switch (event.kind) {
      case "bbStart":
        if (diff === 1) push("bbStart", event);
        break;
      case "allotment":
        if (diff === 1) push("allotment", event);
        break;
      case "purchaseEnd":
        if (diff === 0) push("purchaseDeadline", event);
        break;
      case "lockupExpiry":
        if (diff === LOCKUP_NOTICE_DAYS || diff === 0) push("lockupExpiry", event, { daysUntil: diff });
        break;
      case "priceReleaseWatch":
        if (diff === 0 && !(previous && previous.has(event.ipo.code))) {
          push("priceReleaseWatch", event);
        }
        break;
      default:
        break;
    }
  }

  return payloads.sort((a, b) => {
    const k = PUSH_EVENT_KINDS.indexOf(a.kind) - PUSH_EVENT_KINDS.indexOf(b.kind);
    return k !== 0 ? k : a.code.localeCompare(b.code);
  });
}

/** 本日時点で 1.5倍ライン監視中の銘柄コード（次回の previousWatchCodes として保存する）。 */
export function priceReleaseWatchCodes(events: CalendarEvent[], todayIso: string): string[] {
  const codes = events
    .filter((e) => e.kind === "priceReleaseWatch" && e.date === todayIso)
    .map((e) => e.ipo.code);
  return Array.from(new Set(codes)).sort();
}

/**
 * 購読者の設定（enabledKinds・watchedCodes）で絞り込む。watchedCodes が空なら何も送らない
 * （v1 はウォッチリストの銘柄のみが対象）。上限件数を超える分は優先順の低いものから落とす。
 */
export function payloadsForSubscriber(
  payloads: PushNotificationPayload[],
  record: Pick<PushSubscriberRecord, "enabledKinds" | "watchedCodes">,
  max = MAX_NOTIFICATIONS_PER_SUBSCRIBER,
): PushNotificationPayload[] {
  const kinds = new Set(record.enabledKinds);
  const codes = new Set(record.watchedCodes);
  return payloads.filter((p) => kinds.has(p.kind) && codes.has(p.code)).slice(0, max);
}
