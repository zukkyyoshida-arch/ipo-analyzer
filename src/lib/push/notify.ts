import type { Ipo } from "@/types/ipo";
import type { PushEventKind, PushNotificationPayload, PushSubscriberRecord } from "@/types/push";
import type { CalendarEvent } from "@/lib/events";
import { daysBetween } from "@/lib/date";
import { formatDate } from "@/lib/format";
import { currentPriceAtListingScale } from "@/lib/price";

// プッシュ通知の対象選定と文面組み立て（純関数）。送信層（send.ts）とは分離する。
// 「今日」は呼び出し側（Cron）が JST で計算して todayIso として渡す。

export const PUSH_EVENT_KINDS: PushEventKind[] = [
  "initialPriceFormed",
  "instantCashRegulation",
  "purchaseDeadline",
  "allotment",
  "offeringPriceDecided",
  "priceRangeAnnounced",
  "bbStart",
  "lockupExpiry",
  "earningsAhead",
  "priceReleaseWatch",
];

export const PUSH_EVENT_LABELS: Record<PushEventKind, string> = {
  bbStart: "明日BB開始",
  allotment: "明日抽選",
  purchaseDeadline: "本日購入期限",
  lockupExpiry: "ロックアップ解除（3日前・当日）",
  priceReleaseWatch: "1.5倍ライン監視",
  priceRangeAnnounced: "仮条件発表",
  offeringPriceDecided: "公開価格決定",
  initialPriceFormed: "初値決定",
  earningsAhead: "初決算（3日前・前日）",
  instantCashRegulation: "即金規制の可能性",
};

/**
 * 仮条件・公開価格の通知追加前（v1）の種別。既存購読の enabledKinds がこれを全て含めば、後から追加した種別
 * （仮条件・公開価格・初値決定・初決算・即金規制）も有効とみなす。
 */
const V1_EVENT_KINDS: PushEventKind[] = [
  "purchaseDeadline",
  "allotment",
  "bbStart",
  "lockupExpiry",
  "priceReleaseWatch",
];

/** ロックアップ解除を何日前に予告するか（予告はこの日と当日の2回だけ。毎日連続では鳴らさない）。 */
export const LOCKUP_NOTICE_DAYS = 3;
/** 初決算を何日前に予告するか（3 日前と前日の 2 回だけ）。 */
export const EARNINGS_NOTICE_DAYS: readonly number[] = [3, 1];
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
  /** lockupExpiry・earningsAhead: その日までの日数（0 = 本日）。 */
  daysUntil?: number;
  /** initialPriceFormed: 付いた初値（円・上場時の単位）。省略時は ipo.initialPrice。 */
  initialPrice?: number | null;
  /** initialPriceFormed: 予想初値の 80% レンジ（円）。予想が使えないときは省略。 */
  forecastRange?: { low: number; high: number } | null;
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
    case "priceRangeAnnounced":
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.priceRangeAnnounced, ipo),
        body: priceRangeBody(toPriceFields(ipo)),
      };
    case "offeringPriceDecided":
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.offeringPriceDecided, ipo),
        body: offeringPriceBody(toPriceFields(ipo)),
      };
    case "initialPriceFormed":
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.initialPriceFormed, ipo),
        body: initialPriceBody(ipo, options.initialPrice ?? ipo.initialPrice, options.forecastRange ?? null),
      };
    case "earningsAhead": {
      const days = options.daysUntil;
      const label =
        days === undefined ? "初決算予定" : days <= 0 ? "本日初決算" : days === 1 ? "明日初決算" : `初決算まで${days}日`;
      const date = options.date ?? ipo.firstEarningsDate ?? "";
      const when = date ? `${shortDate(date)}に` : "";
      return {
        ...base,
        title: heading(label, ipo),
        body: `上場後最初の決算発表が${when}予定されています（参考情報）。`,
      };
    }
    case "instantCashRegulation":
      return {
        ...base,
        title: heading(PUSH_EVENT_LABELS.instantCashRegulation, ipo),
        body: "上場初日は初値が付きませんでした。明日は即金規制（現金・指値のみ）となる可能性があります（参考情報）。",
      };
    case "priceReleaseWatch": {
      const offering = ipo.offeringPrice;
      // 直近終値は現在の単位。株式分割があれば上場時の単位（公開価格と同じ）に直して倍率を出す。
      const current = currentPriceAtListingScale(ipo);
      const ratio =
        offering !== null && offering > 0 && current !== null
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

// ---- 仮条件発表・公開価格決定（前回スナップショットとの差分で検知） ----

/** Cron 間で KV に保存する銘柄ごとの価格状態。priceRange は未取得なら null。 */
export interface PriceSnapshotEntry {
  code: string;
  name: string;
  assumedPrice: number;
  priceRange: { low: number; high: number } | null;
  offeringPrice: number | null;
}

type PriceFields = Omit<PriceSnapshotEntry, "code" | "name">;

function isPositive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** 想定価格だけで埋めた仮置き（low=high=想定価格）か。merge/scoring と同じ判定。 */
function isPlaceholderRange(ipo: Pick<Ipo, "assumedPrice" | "priceRange">): boolean {
  return ipo.priceRange.low === ipo.priceRange.high && ipo.priceRange.low === ipo.assumedPrice;
}

function toPriceFields(ipo: Ipo): PriceFields {
  const placeholder = isPlaceholderRange(ipo);
  const rangeKnown =
    isPositive(ipo.priceRange.low) && isPositive(ipo.priceRange.high) && !placeholder;
  // 仮置きレンジと同値の公開価格も CSV の埋め値なので未決定扱い。
  const offeringKnown =
    isPositive(ipo.offeringPrice) && !(placeholder && ipo.offeringPrice === ipo.assumedPrice);
  return {
    assumedPrice: ipo.assumedPrice,
    priceRange: rangeKnown ? { low: ipo.priceRange.low, high: ipo.priceRange.high } : null,
    offeringPrice: offeringKnown ? ipo.offeringPrice : null,
  };
}

/** 全銘柄の価格スナップショット（コード順）。 */
export function buildPriceSnapshot(ipos: Ipo[]): PriceSnapshotEntry[] {
  return ipos
    .map((ipo) => ({ code: ipo.code, name: ipo.name, ...toPriceFields(ipo) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

function signedPct(value: number, base: number): string {
  const pct = ((value - base) / base) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function initialPriceBody(
  ipo: Ipo,
  initialPrice: number | null | undefined,
  forecastRange: { low: number; high: number } | null,
): string {
  if (!isPositive(initialPrice)) return "初値が付きました。値は銘柄ページで確認できます（参考情報）。";
  const parts: string[] = [];
  if (isPositive(ipo.offeringPrice)) parts.push(`公開価格比 ×${(initialPrice / ipo.offeringPrice).toFixed(2)}`);
  if (forecastRange && isPositive(forecastRange.low) && isPositive(forecastRange.high)) {
    const where =
      initialPrice > forecastRange.high ? "を上回る" : initialPrice < forecastRange.low ? "を下回る" : "の範囲内";
    parts.push(`予想レンジ${yen(forecastRange.low)}〜${yen(forecastRange.high)}${where}`);
  }
  const detail = parts.length > 0 ? `（${parts.join("、")}）` : "";
  return `初値は${yen(initialPrice)}${detail}です（参考情報）。`;
}

function priceRangeBody(f: PriceFields): string {
  const range = f.priceRange;
  if (!range) return "仮条件が発表されました。条件は銘柄ページで確認できます（参考情報）。";
  const text = `仮条件は${yen(range.low)}〜${yen(range.high)}`;
  if (!isPositive(f.assumedPrice)) return `${text}です（参考情報）。`;
  const assumed = `想定価格${yen(f.assumedPrice)}`;
  if (range.low > f.assumedPrice) {
    return `${text}で、${assumed}から上振れ（下限で${signedPct(range.low, f.assumedPrice)}）です（参考情報）。`;
  }
  if (range.high < f.assumedPrice) {
    return `${text}で、${assumed}から下振れ（上限で${signedPct(range.high, f.assumedPrice)}）です（参考情報）。`;
  }
  return `${text}で、${assumed}を含む範囲内（下限${signedPct(range.low, f.assumedPrice)}／上限${signedPct(range.high, f.assumedPrice)}）です（参考情報）。`;
}

function offeringPriceBody(f: PriceFields): string {
  const offering = f.offeringPrice;
  if (!isPositive(offering)) return "公開価格が決まりました。条件は銘柄ページで確認できます（参考情報）。";
  const parts: string[] = [];
  const range = f.priceRange;
  if (range) {
    const where =
      range.low === range.high
        ? "仮条件と同値"
        : offering > range.high
          ? "仮条件の上限超え"
          : offering === range.high
            ? "仮条件の上限"
            : offering < range.low
              ? "仮条件の下限未満"
              : offering === range.low
                ? "仮条件の下限"
                : "仮条件の範囲内";
    parts.push(`${where}（${yen(range.low)}〜${yen(range.high)}）`);
  }
  if (isPositive(f.assumedPrice)) parts.push(`想定価格比${signedPct(offering, f.assumedPrice)}`);
  const detail = parts.length > 0 ? `。${parts.join("、")}` : "";
  return `公開価格は${yen(offering)}に決まりました${detail}（参考情報）。`;
}

/**
 * 前回と今回の価格スナップショットの差分から通知を作る。
 * - 仮条件発表: priceRange が未取得（null）→取得
 * - 公開価格決定: offeringPrice が null→数値
 * 前回スナップショットが無い（初回）ときと、前回に無かった銘柄は通知しない（初回に既存分が一斉に鳴るのを防ぐ）。
 */
export function detectPriceChanges(
  prev: readonly PriceSnapshotEntry[] | null | undefined,
  current: readonly PriceSnapshotEntry[],
): PushNotificationPayload[] {
  if (!prev) return [];
  const before = new Map(prev.map((e) => [e.code, e]));
  const payloads: PushNotificationPayload[] = [];
  for (const entry of current) {
    const old = before.get(entry.code);
    if (!old) continue;
    const base = { url: `/ipo/${entry.code}`, code: entry.code };
    const title = (label: string) => `${label}：${entry.name}（${entry.code}）`;
    if (old.priceRange === null && entry.priceRange !== null) {
      payloads.push({
        ...base,
        kind: "priceRangeAnnounced",
        title: title(PUSH_EVENT_LABELS.priceRangeAnnounced),
        body: priceRangeBody(entry),
      });
    }
    if (old.offeringPrice === null && entry.offeringPrice !== null) {
      payloads.push({
        ...base,
        kind: "offeringPriceDecided",
        title: title(PUSH_EVENT_LABELS.offeringPriceDecided),
        body: offeringPriceBody(entry),
      });
    }
  }
  return sortPayloads(payloads);
}

/** KV から読んだ値をスナップショットとして検証する。壊れていれば null（初回扱い）。 */
export function parsePriceSnapshot(raw: unknown): PriceSnapshotEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PriceSnapshotEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.code !== "string") continue;
    const range = e.priceRange as { low?: unknown; high?: unknown } | null | undefined;
    out.push({
      code: e.code,
      name: typeof e.name === "string" ? e.name : e.code,
      assumedPrice: typeof e.assumedPrice === "number" ? e.assumedPrice : 0,
      priceRange:
        range && typeof range.low === "number" && typeof range.high === "number"
          ? { low: range.low, high: range.high }
          : null,
      offeringPrice: typeof e.offeringPrice === "number" ? e.offeringPrice : null,
    });
  }
  return out;
}

/** 種別の優先順→銘柄コード順に並べる。 */
export function sortPayloads(payloads: PushNotificationPayload[]): PushNotificationPayload[] {
  return [...payloads].sort((a, b) => {
    const k = PUSH_EVENT_KINDS.indexOf(a.kind) - PUSH_EVENT_KINDS.indexOf(b.kind);
    return k !== 0 ? k : a.code.localeCompare(b.code);
  });
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
 * - 初決算（firstEarnings が today+3 と today+1 の2回のみ）
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
      case "firstEarnings":
        if (EARNINGS_NOTICE_DAYS.includes(diff)) push("earningsAhead", event, { daysUntil: diff });
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

  return sortPayloads(payloads);
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
  // 新種別の追加前に登録された購読（v1 の全種別を有効）は、追加された種別も有効とみなす。
  if (V1_EVENT_KINDS.every((k) => kinds.has(k))) {
    for (const k of PUSH_EVENT_KINDS) kinds.add(k);
  }
  const codes = new Set(record.watchedCodes);
  return payloads.filter((p) => kinds.has(p.kind) && codes.has(p.code)).slice(0, max);
}
