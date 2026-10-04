// 売買カレンダーの予定（手動・優待の自動）の型と組み立て。純関数。
// 既存のイベントカレンダー（src/lib/events）は IPO の日程専用（予定が Ipo を必ず持つ）なので、
// 一般の銘柄・手動の予定を載せるためにこちらは別に持つ。

import { addDaysIso, daysBetween } from "../date";
import { monthEndIso, monthStartIso, weekdayOf } from "./businessDays";
import { yutaiRollTarget, yutaiSchedulesInRange } from "./yutaiDates";

/** 手動の予定の種類。 */
export type ManualEventKind = "buy" | "sell" | "earnings" | "lastCum" | "other";

export const MANUAL_EVENT_KINDS: { value: ManualEventKind; label: string }[] = [
  { value: "buy", label: "買い" },
  { value: "sell", label: "売り" },
  { value: "earnings", label: "決算" },
  { value: "lastCum", label: "権利付最終日" },
  { value: "other", label: "その他" },
];

/** 手動の予定（localStorage に保存）。 */
export interface ManualEvent {
  id: string;
  /** 証券コード（空でもよい） */
  code: string;
  /** 名称（任意） */
  name: string;
  /** 日付（YYYY-MM-DD） */
  date: string;
  kind: ManualEventKind;
  memo: string;
}

export const MANUAL_EVENTS_STORAGE_KEY = "ipo-analyzer:trade-calendar:v1";

/** カレンダーに出す予定の種類（色分けに使う）。 */
export type CalendarItemKind = ManualEventKind | "yutaiBuyStart" | "yutaiLastCum" | "yutaiEx" | "yutaiRoll";

export const CALENDAR_ITEM_LABELS: Record<CalendarItemKind, string> = {
  buy: "買い",
  sell: "売り",
  earnings: "決算",
  lastCum: "権利付最終日",
  other: "その他",
  yutaiBuyStart: "優待 買い開始",
  yutaiLastCum: "権利付最終日",
  yutaiEx: "権利落ち日",
  yutaiRoll: "優待 資金の回し先",
};

/** カレンダーに出す予定 1 件。 */
export interface CalendarItem {
  /** 一覧の key（手動の予定は manual:<id>） */
  key: string;
  date: string;
  kind: CalendarItemKind;
  /** 見出し（例「3月権利 買い開始」「7203 トヨタ 決算」） */
  title: string;
  memo: string;
  /** 出どころ。manual だけ編集・削除できる */
  source: "manual" | "yutai";
  /** 手動の予定の id（source = manual のとき） */
  manualId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_VALUES = new Set<string>(MANUAL_EVENT_KINDS.map((k) => k.value));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** localStorage の値（unknown）を手動の予定の一覧にする。形の崩れた行は落とす。 */
export function parseManualEvents(raw: unknown): ManualEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualEvent[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    if (typeof r.id !== "string" || r.id === "") continue;
    if (typeof r.date !== "string" || !ISO_DATE.test(r.date)) continue;
    out.push({
      id: r.id,
      code: typeof r.code === "string" ? r.code : "",
      name: typeof r.name === "string" ? r.name : "",
      date: r.date,
      kind: typeof r.kind === "string" && KIND_VALUES.has(r.kind) ? (r.kind as ManualEventKind) : "other",
      memo: typeof r.memo === "string" ? r.memo : "",
    });
  }
  return out;
}

/** 「7203 トヨタ」のような銘柄の表記。両方空なら空文字。 */
export function stockLabel(code: string, name: string): string {
  return [code, name].filter((s) => s !== "").join(" ");
}

/** 同じ日の並び順（自動 → 手動、種類順）。 */
const ORDER: CalendarItemKind[] = [
  "yutaiBuyStart",
  "yutaiLastCum",
  "yutaiEx",
  "yutaiRoll",
  "lastCum",
  "earnings",
  "buy",
  "sell",
  "other",
];

function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const k = ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
  return k !== 0 ? k : a.title.localeCompare(b.title, "ja");
}

/**
 * fromIso〜toIso（両端含む）の予定を集める。
 * - 優待の自動の予定（月ごとの買い開始日・権利付最終日・権利落ち日）
 * - 手動の予定
 */
export function buildCalendarItems({
  manual,
  fromIso,
  toIso,
}: {
  manual: ManualEvent[];
  fromIso: string;
  toIso: string;
}): CalendarItem[] {
  const inRange = (d: string) => d >= fromIso && d <= toIso;
  const items: CalendarItem[] = [];

  for (const s of yutaiSchedulesInRange(fromIso, toIso)) {
    const head = `${s.month}月権利`;
    const auto: [CalendarItemKind, string, string][] = [
      ["yutaiBuyStart", s.buyStart, `${head} 買い開始`],
      ["yutaiLastCum", s.lastCumDate, `${head} 権利付最終日`],
      ["yutaiEx", s.exDate, `${head} 権利落ち日`],
    ];
    for (const [kind, date, title] of auto) {
      if (inRange(date)) items.push({ key: `yutai:${s.year}-${s.month}:${kind}`, date, kind, title, memo: "", source: "yutai" });
    }
    // 売却資金の回し先（権利落ち日に、次に買い開始する権利月へ備える）
    if (inRange(s.exDate)) {
      const to = yutaiRollTarget(s.year, s.month);
      items.push({
        key: `yutai:${s.year}-${s.month}:yutaiRoll`,
        date: s.exDate,
        kind: "yutaiRoll",
        title: `${head} 売却資金 → ${to.month}月権利に備える`,
        memo: `買い開始は ${Number(to.buyStart.slice(5, 7))}/${Number(to.buyStart.slice(8, 10))}`,
        source: "yutai",
      });
    }
  }

  for (const e of manual) {
    if (!inRange(e.date)) continue;
    const label = stockLabel(e.code, e.name);
    const kindLabel = CALENDAR_ITEM_LABELS[e.kind];
    items.push({
      key: `manual:${e.id}`,
      date: e.date,
      kind: e.kind,
      title: label ? `${label} ${kindLabel}` : kindLabel,
      memo: e.memo,
      source: "manual",
      manualId: e.id,
    });
  }

  return items.sort(compareItems);
}

/** 月のカレンダーの枠（日曜始まり）。前後の月の日は null。週ごとに 7 マス。 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = monthStartIso(year, month);
  const last = monthEndIso(year, month);
  const cells: (string | null)[] = Array.from({ length: weekdayOf(first) }, () => null);
  for (let d = first; d <= last; d = addDaysIso(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 年月を n か月ずらす。 */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** 「今日」「明日」「3日後」のような近さの表記。 */
export function relativeDayLabel(date: string, todayIso: string): string {
  const d = daysBetween(todayIso, date);
  if (d === 0) return "今日";
  if (d === 1) return "明日";
  return d > 0 ? `${d}日後` : `${-d}日前`;
}

/** 今日から days 日以内（今日を含む）の予定。「今週の予定」に出す。 */
export function soonItems(items: CalendarItem[], todayIso: string, days = 3): CalendarItem[] {
  const end = addDaysIso(todayIso, days);
  return items.filter((i) => i.date >= todayIso && i.date <= end);
}

/** 日付ごとにまとめる（items は日付順の前提）。 */
export function groupByDate(items: CalendarItem[]): { date: string; items: CalendarItem[] }[] {
  const groups: { date: string; items: CalendarItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else groups.push({ date: it.date, items: [it] });
  }
  return groups;
}
