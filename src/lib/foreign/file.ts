// 外国法人等比率（foreign.json）の組み立て・検証。純関数。
// 取得（EDINET の有報 CSV → 比率）は scripts/updater/foreign.ts。ここは保存形式と鮮度の判定だけ。

import { daysBetween } from "../date";
import type { ForeignFile, ForeignItem } from "../../types/foreign";

/** 提出日からこの月数を超えたら古いデータ扱い（有報は年 1 回。提出遅れの余裕を見て 18 か月）。 */
export const FOREIGN_STALE_MONTHS = 18;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRatio(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

/** 1 件を検証する（壊れていれば null）。 */
function parseItem(raw: unknown): ForeignItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isRatio(o.ratioPercent)) return null;
  if (typeof o.fiscalYearEnd !== "string" || !ISO_DATE.test(o.fiscalYearEnd)) return null;
  if (typeof o.submitDate !== "string" || !ISO_DATE.test(o.submitDate)) return null;
  if (typeof o.docId !== "string" || o.docId === "") return null;
  const item: ForeignItem = {
    ratioPercent: o.ratioPercent,
    fiscalYearEnd: o.fiscalYearEnd,
    submitDate: o.submitDate,
    docId: o.docId,
  };
  if (
    isRatio(o.prevRatioPercent) &&
    typeof o.prevFiscalYearEnd === "string" &&
    ISO_DATE.test(o.prevFiscalYearEnd) &&
    o.prevFiscalYearEnd < o.fiscalYearEnd
  ) {
    item.prevRatioPercent = o.prevRatioPercent;
    item.prevFiscalYearEnd = o.prevFiscalYearEnd;
  }
  return item;
}

/** 保存済みの JSON を検証して ForeignFile にする（壊れていれば null。壊れた 1 件は捨てる）。 */
export function parseForeignFile(raw: unknown): ForeignFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.generatedAt !== "string" || typeof o.scannedThrough !== "string") return null;
  if (o.scannedThrough !== "" && !ISO_DATE.test(o.scannedThrough)) return null;
  if (!o.items || typeof o.items !== "object" || Array.isArray(o.items)) return null;
  const items: Record<string, ForeignItem> = {};
  for (const [code, v] of Object.entries(o.items as Record<string, unknown>)) {
    const it = parseItem(v);
    if (it) items[code] = it;
  }
  return { generatedAt: o.generatedAt, scannedThrough: o.scannedThrough, items };
}

/** ForeignFile を作る（コード順に並べ、差分を読みやすくする）。 */
export function buildForeignFile(
  items: Readonly<Record<string, ForeignItem>>,
  scannedThrough: string,
  now: Date,
): ForeignFile {
  const sorted: Record<string, ForeignItem> = {};
  for (const code of Object.keys(items).sort()) sorted[code] = items[code];
  return { generatedAt: now.toISOString(), scannedThrough, items: sorted };
}

/** iso から months か月前の日付（月末の繰り下がりは気にしない目安の計算）。 */
function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 提出日が今日から 18 か月より前なら古い（次の有報が出ていないか、取りこぼしている）。 */
export function isForeignStale(submitDate: string, todayIso: string): boolean {
  if (!ISO_DATE.test(submitDate)) return true;
  if (daysBetween(submitDate, todayIso) < 0) return false;
  return submitDate < monthsBefore(todayIso, FOREIGN_STALE_MONTHS);
}

/** 古くない 1 件だけを返す（古い・無いなら undefined＝不明扱い）。 */
export function freshForeignItem(item: ForeignItem | null | undefined, todayIso: string): ForeignItem | undefined {
  return item && !isForeignStale(item.submitDate, todayIso) ? item : undefined;
}

/** 生成時刻以外が同じか（同じなら書き換えず、夜間ジョブの差分を増やさない）。 */
export function sameForeignContent(a: ForeignFile | null, b: ForeignFile): boolean {
  if (!a) return false;
  const strip = (f: ForeignFile) => JSON.stringify({ scannedThrough: f.scannedThrough, items: f.items });
  return strip(a) === strip(b);
}
