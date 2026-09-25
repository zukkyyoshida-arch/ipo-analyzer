import bundledEventStats from "../../../public/data/event-stats.json";

// セカンダリーのイベント前後リターンの実績集計（scratch/backtest/event_backtest.py が生成）。
// 数値はすべて % 表記（例: 4.48 = +4.48%）。欠損は null。参考情報として表示する。

export const EVENT_STAT_KINDS = [
  "lockupExpiry",
  "priceRelease15x",
  "firstEarnings",
] as const;

export type EventStatKind = (typeof EVENT_STAT_KINDS)[number];

export const EVENT_STAT_LABELS: Record<EventStatKind, string> = {
  lockupExpiry: "ロックアップ解除日",
  priceRelease15x: "1.5倍解除の到達日",
  firstEarnings: "初回決算の発表日",
};

export interface EventStatYear {
  year: number;
  sampleCount: number;
  medianAfter20: number | null;
}

export interface EventStat {
  /** 後20営業日リターンが計算できた件数 */
  sampleCount: number;
  meanBefore20: number | null;
  meanAfter5: number | null;
  meanAfter20: number | null;
  medianAfter20: number | null;
  /** 後20営業日リターンがプラスだった割合（%） */
  winRateAfter20: number | null;
  years: EventStatYear[];
}

export interface EventStatsFile {
  /** 価格データの最終日（YYYY-MM-DD） */
  asOf: string;
  kinds: Partial<Record<EventStatKind, EventStat>>;
}

/** 母数がこれ未満なら「目安として弱い」と明示する。 */
export const EVENT_WEAK_SAMPLE_THRESHOLD = 20;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 1 種別分を検証しつつ正規化する。形が崩れていれば null。 */
function parseStat(raw: unknown): EventStat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sampleCount = num(r.sampleCount);
  if (sampleCount === null || sampleCount < 0) return null;
  const years = Array.isArray(r.years)
    ? r.years.flatMap((y): EventStatYear[] => {
        if (!y || typeof y !== "object") return [];
        const o = y as Record<string, unknown>;
        const year = num(o.year);
        const count = num(o.sampleCount);
        if (year === null || count === null) return [];
        return [{ year, sampleCount: count, medianAfter20: num(o.medianAfter20) }];
      })
    : [];
  return {
    sampleCount,
    meanBefore20: num(r.meanBefore20),
    meanAfter5: num(r.meanAfter5),
    meanAfter20: num(r.meanAfter20),
    medianAfter20: num(r.medianAfter20),
    winRateAfter20: num(r.winRateAfter20),
    years,
  };
}

/** event-stats.json（unknown）を型付きに正規化する。不正な種別は落とす。 */
export function parseEventStats(raw: unknown): EventStatsFile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kindsRaw = (r.kinds && typeof r.kinds === "object" ? r.kinds : {}) as Record<
    string,
    unknown
  >;
  const kinds: Partial<Record<EventStatKind, EventStat>> = {};
  for (const kind of EVENT_STAT_KINDS) {
    const stat = parseStat(kindsRaw[kind]);
    if (stat) kinds[kind] = stat;
  }
  return { asOf: typeof r.asOf === "string" ? r.asOf : "", kinds };
}

/** 同梱の event-stats.json を読む。 */
export function getEventStats(): EventStatsFile {
  return parseEventStats(bundledEventStats);
}

/** 母数に応じた注記。0 件は null（数値を出さない）。 */
export function eventSampleNote(sampleCount: number): string | null {
  if (sampleCount <= 0) return null;
  return sampleCount < EVENT_WEAK_SAMPLE_THRESHOLD
    ? `母数${sampleCount}件・目安として弱い`
    : `母数${sampleCount}件`;
}

/** 集計対象年の範囲表記（例: "2024〜2026年"）。年が無ければ空文字。 */
export function eventYearsRange(stat: EventStat): string {
  const ys = stat.years.filter((y) => y.sampleCount > 0).map((y) => y.year);
  if (ys.length === 0) return "";
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return min === max ? `${min}年` : `${min}〜${max}年`;
}
