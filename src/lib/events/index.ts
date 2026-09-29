import type { Ipo } from "@/types/ipo";
import { addDaysIso, daysBetween } from "@/lib/date";
import { formatDate } from "@/lib/format";
import { currentPriceAtListingScale, hasSplit, roundPrice, toCurrentScale } from "@/lib/price";

// イベントカレンダー（/events）向けの横断イベント収集。純関数・テスト対象。
// Date.now は呼ばない。「今日」は呼び出し側（page.tsx）が todayIso として渡す。
// ロックアップ・1.5倍ラインの判定は checklist/items.ts と同じ基準で events 側に独立実装する
// （戻り値の型が異なるため checklist 側は変更しない）。

export type CalendarEventKind =
  | "bbStart"
  | "bbEnd"
  | "allotment"
  | "purchaseStart"
  | "purchaseEnd"
  | "listing"
  | "lockupExpiry" // listingDate + lockup.days
  | "priceReleaseWatch" // 1.5倍解除条項ありの銘柄で、現在値が公開価格1.4倍到達時点から表示
  | "firstEarnings"
  | "largeHoldingReport";

export interface CalendarEvent {
  ipo: Ipo;
  kind: CalendarEventKind;
  date: string; // YYYY-MM-DD
  detail: string;
}

export const CALENDAR_EVENT_LABELS: Record<CalendarEventKind, string> = {
  bbStart: "BB開始",
  bbEnd: "BB締切",
  allotment: "抽選",
  purchaseStart: "購入期間開始",
  purchaseEnd: "購入期限",
  listing: "上場",
  lockupExpiry: "ロック解除",
  priceReleaseWatch: "1.5倍ライン監視",
  firstEarnings: "初決算",
  largeHoldingReport: "大量保有報告",
};

/** 同日内の並び順（BB系 → 上場 → 上場後）。 */
const KIND_ORDER: CalendarEventKind[] = [
  "bbStart",
  "bbEnd",
  "allotment",
  "purchaseStart",
  "purchaseEnd",
  "listing",
  "lockupExpiry",
  "priceReleaseWatch",
  "firstEarnings",
  "largeHoldingReport",
];

const DEFAULT_UPCOMING_DAYS = 90;
const DEFAULT_RECENT_DAYS = 30;
/** 監視を始める倍率（公開価格比）と解除ラインの倍率。 */
const WATCH_RATIO = 1.4;
const RELEASE_RATIO = 1.5;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_RE.test(value);
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (k !== 0) return k;
  return a.ipo.code.localeCompare(b.ipo.code);
}

/** BB期間・抽選・購入期間・上場の6種（日付が入っているものだけ）。 */
function scheduleEvents(ipo: Ipo): CalendarEvent[] {
  const bb = ipo.bbPeriod;
  const purchase = ipo.purchasePeriod;
  const bbRange =
    isIsoDate(bb.start) && isIsoDate(bb.end)
      ? `BB期間 ${formatDate(bb.start)}〜${formatDate(bb.end)}`
      : "BB期間";
  const purchaseRange =
    isIsoDate(purchase.start) && isIsoDate(purchase.end)
      ? `購入期間 ${formatDate(purchase.start)}〜${formatDate(purchase.end)}`
      : "購入期間";

  const candidates: [CalendarEventKind, string, string][] = [
    ["bbStart", bb.start, `${bbRange}（開始日）`],
    ["bbEnd", bb.end, `${bbRange}（最終日）`],
    ["allotment", ipo.allotmentDate, "公開価格決定・抽選日"],
    ["purchaseStart", purchase.start, `${purchaseRange}（開始日）`],
    ["purchaseEnd", purchase.end, `${purchaseRange}（最終日）`],
    ["listing", ipo.listingDate, `${ipo.market}市場に上場`],
  ];

  const events: CalendarEvent[] = [];
  for (const [kind, date, detail] of candidates) {
    if (!isIsoDate(date)) continue;
    events.push({ ipo, kind, date, detail });
  }
  return events;
}

/**
 * ロックアップ解除日イベント（lockup.days>0 かつ listingDateありのみ）。
 * 解除日が todayIso より前（通過済み）なら null。
 */
export function lockupExpiryEvent(
  ipo: Ipo,
  todayIso: string,
): CalendarEvent | null {
  if (!(ipo.lockup.days > 0) || !isIsoDate(ipo.listingDate)) return null;
  const expiryDate = addDaysIso(ipo.listingDate, ipo.lockup.days);
  if (daysBetween(todayIso, expiryDate) < 0) return null;
  return {
    ipo,
    kind: "lockupExpiry",
    date: expiryDate,
    detail: `上場日から${ipo.lockup.days}日のロックアップ期間が終了（参考情報）`,
  };
}

/**
 * 1.5倍解除ラインの監視イベント。1.4倍到達時点から「本日時点で監視中」として返す
 * （date は todayIso）。条件: 1.5倍解除条項あり・公開価格と直近終値あり・
 * 直近終値 >= 公開価格×1.4・ロックアップ期間が終了していない。
 * 株式分割があれば、直近終値（現在の単位）を上場時の単位に直して公開価格と比べる。
 */
export function priceReleaseWatchEvent(
  ipo: Ipo,
  todayIso: string,
): CalendarEvent | null {
  if (!ipo.lockup.hasPriceRelease) return null;
  const offering = ipo.offeringPrice;
  const current = ipo.currentPrice;
  const currentAtListing = currentPriceAtListingScale(ipo);
  if (offering === null || offering <= 0) return null;
  if (current === null || current === undefined || currentAtListing === null) return null;
  if (currentAtListing < offering * WATCH_RATIO) return null;

  // ロックアップ期間が終わっていれば価格解除条項は意味を持たないので対象外。
  if (ipo.lockup.days > 0 && isIsoDate(ipo.listingDate)) {
    const expiryDate = addDaysIso(ipo.listingDate, ipo.lockup.days);
    if (daysBetween(todayIso, expiryDate) < 0) return null;
  }

  // 表示する価格は直近終値と同じ現在の単位にそろえる（分割があれば 1.5倍ラインも換算する）。
  const releaseLineText = hasSplit(ipo)
    ? `${roundPrice(toCurrentScale(offering * RELEASE_RATIO, ipo)).toLocaleString()}円（分割換算後）`
    : `${Math.round(offering * RELEASE_RATIO).toLocaleString()}円`;
  const ratio = (currentAtListing / offering).toFixed(2);
  const state = currentAtListing >= offering * RELEASE_RATIO ? "到達圏" : "接近";
  return {
    ipo,
    kind: "priceReleaseWatch",
    date: todayIso,
    detail: `直近終値${current.toLocaleString()}円（公開価格の${ratio}倍）。1.5倍ライン${releaseLineText}に${state}`,
  };
}

/** 上場後最初の決算発表予定日。未定なら null。 */
export function firstEarningsEvent(ipo: Ipo): CalendarEvent | null {
  if (!isIsoDate(ipo.firstEarningsDate)) return null;
  return {
    ipo,
    kind: "firstEarnings",
    date: ipo.firstEarningsDate,
    detail: "上場後最初の決算発表予定日",
  };
}

/**
 * 既存 upcomingEvents（home/index.ts）のBB系4種（＋BB締切・購入期限）に、上場後3種
 * （lockupExpiry, firstEarnings, priceReleaseWatch）を加えた横断イベント一覧。
 * largeHoldingReport は過去日程のため別関数 recentLargeHoldingReports に分離。
 * days: 対象期間（today起点・両端含む、既定90日）。日付昇順、同日は種別順→コード順。
 */
export function upcomingCalendarEvents(
  ipos: Ipo[],
  todayIso: string,
  days = DEFAULT_UPCOMING_DAYS,
): CalendarEvent[] {
  if (!isIsoDate(todayIso)) return [];

  const events: CalendarEvent[] = [];
  for (const ipo of ipos) {
    const candidates: (CalendarEvent | null)[] = [
      ...scheduleEvents(ipo),
      lockupExpiryEvent(ipo, todayIso),
      priceReleaseWatchEvent(ipo, todayIso),
      firstEarningsEvent(ipo),
    ];
    for (const event of candidates) {
      if (event === null) continue;
      const diff = daysBetween(todayIso, event.date);
      if (diff < 0 || diff > days) continue;
      events.push(event);
    }
  }

  return events.sort(compareEvents);
}

/**
 * 直近30日以内に提出された大量保有報告書（過去日程・"新着"として別枠表示）。
 * 対象: 提出日が [today-withinDays, today]（両端含む）。新しい順（日付降順）。
 */
export function recentLargeHoldingReports(
  ipos: Ipo[],
  todayIso: string,
  withinDays = DEFAULT_RECENT_DAYS,
): CalendarEvent[] {
  if (!isIsoDate(todayIso)) return [];

  const events: CalendarEvent[] = [];
  for (const ipo of ipos) {
    const report = ipo.largeHoldingReport;
    if (!report || !isIsoDate(report.date)) continue;
    const elapsed = daysBetween(report.date, todayIso);
    if (elapsed < 0 || elapsed > withinDays) continue;
    events.push({
      ipo,
      kind: "largeHoldingReport",
      date: report.date,
      detail: `${report.holder}が大量保有報告書を提出`,
    });
  }

  return events.sort((a, b) => -compareEvents(a, b));
}

/** 日付ごとにまとめる（入力の並び順を保つ）。UI の小見出しグルーピング用。 */
export function groupEventsByDate(
  events: CalendarEvent[],
): { date: string; events: CalendarEvent[] }[] {
  const groups: { date: string; events: CalendarEvent[] }[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === event.date) {
      last.events.push(event);
    } else {
      groups.push({ date: event.date, events: [event] });
    }
  }
  return groups;
}
