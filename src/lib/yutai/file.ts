// 月別ファイル public/data/yutai/<M>.json（株主優待の先回り買い）の読み込み時の検証と、月まわりの小さな整形。純関数。
// 生成は scripts/updater/yutai.ts、型は ./types.ts、候補の並べ替えは src/lib/picks/yutai.ts。

import { daysBetween } from "../date";
import type { YutaiCandle, YutaiItem, YutaiMonth, YutaiMonthFile } from "./types";

/** asOf がこの日数以上前なら「古い」とみなす。 */
export const YUTAI_STALE_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCandle(raw: unknown): YutaiCandle | null {
  if (!isRecord(raw)) return null;
  const year = num(raw.year);
  const open = num(raw.open);
  const close = num(raw.close);
  if (year === null || open === null || close === null || open <= 0) return null;
  return { year: Math.round(year), open, close, high: num(raw.high), low: num(raw.low) };
}

function parseItem(raw: unknown): YutaiItem | null {
  if (!isRecord(raw)) return null;
  const { code, name, detailUrl } = raw;
  if (typeof code !== "string" || code === "" || typeof name !== "string") return null;
  const up10 = num(raw.up10);
  const n10 = num(raw.n10);
  const up5 = num(raw.up5);
  const n5 = num(raw.n5);
  if (up10 === null || n10 === null || up5 === null || n5 === null) return null;
  const candles = Array.isArray(raw.candles)
    ? raw.candles.map(parseCandle).filter((c): c is YutaiCandle => c !== null)
    : [];
  return {
    code,
    name,
    minInvest: num(raw.minInvest),
    yutaiYield: num(raw.yutaiYield),
    divYield: num(raw.divYield),
    totalYield: num(raw.totalYield),
    rightsMonths: Array.isArray(raw.rightsMonths)
      ? raw.rightsMonths.filter((m): m is number => typeof m === "number" && Number.isFinite(m))
      : [],
    detailUrl: typeof detailUrl === "string" ? detailUrl : "",
    candles,
    up10,
    n10,
    up5,
    n5,
    avgRet10: num(raw.avgRet10),
    avgHighRet10: num(raw.avgHighRet10),
    price: num(raw.price),
    high12: num(raw.high12),
    low12: num(raw.low12),
  };
}

function parseMonth(raw: unknown, key: string): YutaiMonth | null {
  if (!isRecord(raw)) return null;
  const month = num(raw.month) ?? Number(key);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(parseItem).filter((x): x is YutaiItem => x !== null)
    : [];
  const listed = num(raw.listedCount);
  const prev = num(raw.prevMonth);
  return {
    month,
    prevMonth: prev !== null ? Math.round(prev) : month === 1 ? 12 : month - 1,
    listUrl: typeof raw.listUrl === "string" ? raw.listUrl : "",
    listedCount: listed !== null && listed >= 0 ? Math.round(listed) : items.length,
    items,
  };
}

/**
 * 月別ファイル public/data/yutai/<M>.json（unknown）を検証して型付きにする。
 * 月が 1〜12 でない・asOf が日付でなければ null。形の崩れた銘柄・月足は落とす。items が空でも返す。
 */
export function parseYutaiMonthFile(raw: unknown): YutaiMonthFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const month = parseMonth(raw, String(raw.month));
  if (!month) return null;
  return { ...month, asOf, generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "" };
}

/** asOf が todayIso から staleDays 日以上前か（日付が崩れていれば古い扱い）。 */
export function isYutaiStale(asOf: string, todayIso: string, staleDays = YUTAI_STALE_DAYS): boolean {
  if (!ISO_DATE.test(asOf) || !ISO_DATE.test(todayIso)) return true;
  return daysBetween(asOf, todayIso) >= staleDays;
}

/** 既定の権利確定月 ＝ 今月＋2（前月の月足を見て、月初に買う想定）。12 を超えたら 1 から数え直す。 */
export function defaultYutaiMonth(todayIso: string): number {
  const m = Number(todayIso.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) return 1;
  return ((m + 1) % 12) + 1;
}

/** 月の表示（12 → "12月"）。 */
export function monthLabel(m: number): string {
  return `${m}月`;
}
