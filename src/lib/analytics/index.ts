import type { Ipo } from "@/types/ipo";
import { initialReturnRate } from "@/lib/format";

// ホーム「IPO アナリティクス」向けの集計純関数。Date.now は呼ばず、「今日」は todayIso で受け取る。

export type PeriodKey = "30" | "90" | "365" | "all";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "30", label: "過去 30 日間" },
  { value: "90", label: "過去 90 日間" },
  { value: "365", label: "過去 365 日間" },
  { value: "all", label: "全期間" },
];

export function isPeriodKey(v: unknown): v is PeriodKey {
  return v === "30" || v === "90" || v === "365" || v === "all";
}

export function periodLabel(period: PeriodKey): string {
  return PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? "";
}

/** 両端を含む日付範囲（YYYY-MM-DD）。 */
export interface DateWindow {
  start: string;
  end: string;
}

const DAY_MS = 24 * 3600 * 1000;

function toTime(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const t = toTime(iso);
  return t === null ? iso : toIso(t + days * DAY_MS);
}

function daysBetween(start: string, end: string): number {
  const a = toTime(start);
  const b = toTime(end);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * 選択期間の集計範囲と、同じ長さの直前期間を返す。
 * 「過去 N 日間」は today を含む N 日（today-(N-1) 〜 today）。
 * 全期間は上場済の最古の上場日〜today で、直前期間は無い（null）。
 */
export function periodWindows(
  period: PeriodKey,
  todayIso: string,
  ipos: Ipo[],
): { current: DateWindow; previous: DateWindow | null } {
  if (period === "all") {
    const dates = ipos
      .filter((i) => i.status === "listed" && toTime(i.listingDate) !== null)
      .map((i) => i.listingDate)
      .filter((d) => d <= todayIso)
      .sort();
    return {
      current: { start: dates[0] ?? todayIso, end: todayIso },
      previous: null,
    };
  }
  const n = Number(period);
  const start = addDays(todayIso, -(n - 1));
  return {
    current: { start, end: todayIso },
    previous: { start: addDays(start, -n), end: addDays(start, -1) },
  };
}

export function inWindow(iso: string, w: DateWindow): boolean {
  if (toTime(iso) === null) return false;
  return iso >= w.start && iso <= w.end;
}

/** 範囲内に上場した上場済銘柄。 */
export function listedIn(ipos: Ipo[], w: DateWindow): Ipo[] {
  return ipos.filter((i) => i.status === "listed" && inWindow(i.listingDate, w));
}

export type MetricKey = "count" | "avgReturn" | "breakRate" | "winRate";

export interface Metrics {
  /** 上場社数（初値未確定も含む）。 */
  count: number;
  /** 初値騰落率の平均（%）。母数 0 なら null。 */
  avgReturn: number | null;
  /** 公募割れ率（初値 < 公開価格の割合、%）。 */
  breakRate: number | null;
  /** 初値勝率（初値 > 公開価格の割合、%）。 */
  winRate: number | null;
  /** 公開価格・初値が揃っている母数。 */
  sample: number;
}

/** 銘柄群の指標を計算する。初値・公開価格が無い銘柄は率の母数から除外する。 */
export function computeMetrics(listed: Ipo[]): Metrics {
  const rates = listed
    .map((i) => initialReturnRate(i))
    .filter((v): v is number => v !== null);
  const sample = rates.length;
  if (sample === 0) {
    return { count: listed.length, avgReturn: null, breakRate: null, winRate: null, sample };
  }
  const sum = rates.reduce((s, v) => s + v, 0);
  return {
    count: listed.length,
    avgReturn: sum / sample,
    breakRate: (rates.filter((v) => v < 0).length / sample) * 100,
    winRate: (rates.filter((v) => v > 0).length / sample) * 100,
    sample,
  };
}

export function metricValue(m: Metrics, key: MetricKey): number | null {
  return key === "count" ? m.count : m[key];
}

/** 前期間比（差）。どちらかが null なら null。 */
export function metricDelta(
  current: Metrics,
  previous: Metrics | null,
  key: MetricKey,
): number | null {
  if (!previous) return null;
  const a = metricValue(current, key);
  const b = metricValue(previous, key);
  if (a === null || b === null) return null;
  return a - b;
}

export interface SeriesPoint {
  /** バケット開始日。 */
  start: string;
  /** バケット終了日（範囲で切り詰め済み）。 */
  end: string;
  metrics: Metrics;
}

export type Granularity = "week" | "month";

/** 120 日以下は週次、それより長ければ月次。 */
export function granularityFor(w: DateWindow): Granularity {
  return daysBetween(w.start, w.end) + 1 <= 120 ? "week" : "month";
}

/**
 * 範囲を週次（開始日から 7 日刻み）または月次（暦月）に区切り、各バケットの指標を返す。
 * 範囲外・初値未確定の扱いは computeMetrics に従う。
 */
export function buildSeries(
  ipos: Ipo[],
  w: DateWindow,
  granularity: Granularity = granularityFor(w),
): SeriesPoint[] {
  if (toTime(w.start) === null || toTime(w.end) === null || w.start > w.end) {
    return [];
  }
  const listed = listedIn(ipos, w);
  const buckets: DateWindow[] = [];
  if (granularity === "week") {
    for (let s = w.start; s <= w.end; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      buckets.push({ start: s, end: e > w.end ? w.end : e });
    }
  } else {
    let y = Number(w.start.slice(0, 4));
    let m = Number(w.start.slice(5, 7));
    let s = w.start;
    while (s <= w.end) {
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const next = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
      const e = addDays(next, -1);
      buckets.push({ start: s, end: e > w.end ? w.end : e });
      s = next;
      y = nextY;
      m = nextM;
    }
  }
  return buckets.map((b) => ({
    start: b.start,
    end: b.end,
    metrics: computeMetrics(listed.filter((i) => inWindow(i.listingDate, b))),
  }));
}

/** 範囲内の上場済銘柄を初値騰落率の降順で返す（初値未確定は除外）。 */
export function rankByInitialReturn(
  ipos: Ipo[],
  w: DateWindow,
): { ipo: Ipo; rate: number }[] {
  return listedIn(ipos, w)
    .map((ipo) => ({ ipo, rate: initialReturnRate(ipo) }))
    .filter((x): x is { ipo: Ipo; rate: number } => x.rate !== null)
    .sort((a, b) => b.rate - a.rate);
}

/** 今後 days 日（today 含む）の日別件数。dates は YYYY-MM-DD の配列。 */
export function dailyCounts(
  dates: string[],
  todayIso: string,
  days = 14,
): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(todayIso, i);
    out.push({ date: d, count: dates.filter((x) => x === d).length });
  }
  return out;
}

/** BB 受付中（bbPeriod が today を含む、または status が bb_open）。 */
export function isBbOpen(ipo: Ipo, todayIso: string): boolean {
  if (ipo.status === "listed") return false;
  const { start, end } = ipo.bbPeriod;
  if (start && end) return start <= todayIso && todayIso <= end;
  return ipo.status === "bb_open";
}
