// hot.json（いま熱い銘柄）の型・読み込み時の検証・表示用の整形。純関数。
// 生成は scripts/updater/hot.ts（夜間のデータ更新）。計算の定義は ./score.ts。

import { daysBetween } from "../date";
import type { HotItem, HotRanking } from "./score";

/** hot.json の中身。 */
export interface HotFile extends HotRanking {
  /** 生成時刻（ISO） */
  generatedAt: string;
}

/** asOf が今日からこの日数以上前なら「古い」（更新待ち）とみなす。 */
export const HOT_STALE_DAYS = 7;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseItem(raw: unknown): HotItem | null {
  if (!isRecord(raw)) return null;
  const { code, name, listingDate, reasons } = raw;
  const score = num(raw.score);
  const r5 = num(raw.r5);
  const r20 = num(raw.r20);
  const highProx = num(raw.highProx);
  const turnover5 = num(raw.turnover5);
  // 日足の本数。古い hot.json には無いので、無い・壊れているときは undefined のまま（従来どおりの表示）
  const barCount = num(raw.bars);
  const bars = barCount !== null && barCount >= 1 ? Math.round(barCount) : undefined;
  if (typeof code !== "string" || code === "" || typeof name !== "string") return null;
  if (score === null || r5 === null || r20 === null || highProx === null || turnover5 === null) {
    return null;
  }
  return {
    code,
    name,
    listingDate: typeof listingDate === "string" && ISO_DATE.test(listingDate) ? listingDate : "",
    score: Math.min(100, Math.max(0, Math.round(score))),
    r5,
    r20,
    volRatio: num(raw.volRatio),
    highProx,
    turnover5,
    ...(bars !== undefined ? { bars } : {}),
    initialRatio: num(raw.initialRatio),
    reasons: Array.isArray(reasons)
      ? reasons.filter((r): r is string => typeof r === "string" && r !== "").slice(0, 3)
      : [],
  };
}

/**
 * hot.json（unknown）を検証して型付きにする。asOf が日付でなければ null。形の崩れた行は落とす。
 */
export function parseHotFile(raw: unknown): HotFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(parseItem).filter((x): x is HotItem => x !== null)
    : [];
  const universe = num(raw.universe);
  return {
    asOf,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    universe: universe !== null && universe >= 0 ? Math.round(universe) : items.length,
    items,
  };
}

/** asOf が todayIso から HOT_STALE_DAYS 日以上前か。 */
export function isHotStale(asOf: string, todayIso: string, staleDays = HOT_STALE_DAYS): boolean {
  if (!ISO_DATE.test(asOf) || !ISO_DATE.test(todayIso)) return true;
  return daysBetween(asOf, todayIso) >= staleDays;
}

/** "2026-09-29" → "9/29"。 */
export function formatMonthDay(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

/** 売買代金（円）の表示。1億以上は「12.3億」、それ未満は「4,500万」。 */
export function formatTurnoverJa(yen: number): string {
  if (!Number.isFinite(yen) || yen <= 0) return "—";
  if (yen >= 1e8) {
    const oku = yen / 1e8;
    return `${oku.toLocaleString("ja-JP", { maximumFractionDigits: oku >= 100 ? 0 : 1 })}億`;
  }
  return `${Math.round(yen / 1e4).toLocaleString("ja-JP")}万`;
}

/** 出来高倍率の表示（null は「—」）。 */
export function formatVolRatio(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}倍`;
}

/** 過熱の注意を出すか（初値倍率が注意ラインを超えているか）。 */
export function isOverheated(initialRatio: number | null, overheatRatio: number): boolean {
  return initialRatio !== null && initialRatio > overheatRatio;
}
