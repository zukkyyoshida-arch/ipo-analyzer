// holdings.json（大量保有報告書）の読み込み時の検証と表示用の整形。純関数。
// 生成は scripts/updater/holdings.ts（夜間のデータ更新）。型は ./types.ts、選定は ./score.ts。
//
// 読み込みは「落ちない」ことを優先する: 形の崩れた行は落とし、欠けた任意項目は既定値で埋める。
// 古い版の holdings.json（項目が足りない・未知の項目がある）もそのまま読める。

import { daysBetween } from "../date";
import {
  HOLDING_FORM_LABELS,
  HOLDING_FORM_TYPES,
  HOLDINGS_SOURCE_TEXT,
  type HoldingFormType,
  type HoldingItem,
  type HoldingsFile,
} from "./types";

/** coveredThrough が今日からこの日数より前なら「古い」（更新待ち）とみなす。夜間ジョブが数日止まっても許す幅（設計値）。 */
export const HOLDINGS_STALE_DAYS = 7;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isoOrEmpty(v: unknown): string {
  return typeof v === "string" && ISO_DATE.test(v) ? v : "";
}

function isFormType(v: unknown): v is HoldingFormType {
  return typeof v === "string" && (HOLDING_FORM_TYPES as readonly string[]).includes(v);
}

/** 割合（小数）として読めるか。0〜1 の範囲外は壊れた値として捨てる。 */
function ratioOrNull(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

function parseItem(raw: unknown): HoldingItem | null {
  if (!isRecord(raw)) return null;
  const code = str(raw.code);
  const docId = str(raw.docId);
  const submitDate = isoOrEmpty(raw.submitDate);
  if (code === "" || docId === "" || submitDate === "") return null;
  const ratio = ratioOrNull(raw.ratio);
  const prevRatio = ratioOrNull(raw.prevRatio);
  const deltaRaw = num(raw.delta);
  // delta は ratio と prevRatio から作り直せるときはそちらを正とする（手で直したファイルでもずれない）
  const delta =
    ratio !== null && prevRatio !== null
      ? Math.round((ratio - prevRatio) * 1e6) / 1e6
      : deltaRaw !== null && Math.abs(deltaRaw) <= 1
        ? deltaRaw
        : null;
  const holdersRaw = num(raw.holders);
  const shares = num(raw.shares);
  const listingDate = isoOrEmpty(raw.listingDate);
  const amendedFrom = str(raw.amendedFrom);
  return {
    code,
    name: str(raw.name) || code,
    docId,
    submitDate,
    filer: str(raw.filer),
    ...(holdersRaw !== null && holdersRaw >= 2 ? { holders: Math.round(holdersRaw) } : {}),
    // 未知の種類（将来の様式など）は「変更報告書」として扱う（加点の少ない側に倒す）
    formType: isFormType(raw.formType) ? raw.formType : "change",
    ratio,
    prevRatio,
    delta,
    purpose: str(raw.purpose),
    ...(raw.proposal === true ? { proposal: true } : {}),
    shares: shares !== null && shares >= 0 ? shares : null,
    reason: str(raw.reason),
    obligationDate: isoOrEmpty(raw.obligationDate),
    ...(listingDate ? { listingDate } : {}),
    ...(amendedFrom ? { amendedFrom } : {}),
  };
}

/** 提出日の新しい順 → 銘柄コード → docID の順に並べる（夜間ジョブの差分を安定させる）。 */
export function compareHoldingItems(a: HoldingItem, b: HoldingItem): number {
  if (a.submitDate !== b.submitDate) return a.submitDate < b.submitDate ? 1 : -1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
}

/** 空の holdings.json（まだ一度も取得していない状態）。 */
export function emptyHoldingsFile(): HoldingsFile {
  return { generatedAt: "", coveredFrom: "", coveredThrough: "", source: HOLDINGS_SOURCE_TEXT, items: [] };
}

/**
 * holdings.json（unknown）を検証して型付きにする。オブジェクトでなければ null。
 * 形の崩れた行は落とし、同じ docID が重なっていれば先の 1 件だけ残す。
 */
export function parseHoldingsFile(raw: unknown): HoldingsFile | null {
  if (!isRecord(raw)) return null;
  const seen = new Set<string>();
  const items: HoldingItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const r of raw.items) {
      const item = parseItem(r);
      if (!item || seen.has(item.docId)) continue;
      seen.add(item.docId);
      items.push(item);
    }
  }
  items.sort(compareHoldingItems);
  return {
    generatedAt: str(raw.generatedAt),
    coveredFrom: isoOrEmpty(raw.coveredFrom),
    coveredThrough: isoOrEmpty(raw.coveredThrough),
    // 出典表記は常に最新の定数を使う（古いファイルの文言が残らないように）
    source: HOLDINGS_SOURCE_TEXT,
    items,
  };
}

/** coveredThrough が todayIso から staleDays 日より前（または未取得）なら true。 */
export function isHoldingsStale(
  file: Pick<HoldingsFile, "coveredThrough"> | null,
  todayIso: string,
  staleDays = HOLDINGS_STALE_DAYS,
): boolean {
  if (!file || !ISO_DATE.test(file.coveredThrough) || !ISO_DATE.test(todayIso)) return true;
  return daysBetween(file.coveredThrough, todayIso) > staleDays;
}

/** 割合（小数）を「16.38%」にする。null は「—」。 */
export function formatHoldingRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}

/** 割合の増減（小数）を「+1.20pt」「−0.41pt」にする。null は「—」。 */
export function formatHoldingDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const pt = Math.round(delta * 10000) / 100;
  if (pt === 0) return "±0.00pt";
  return `${pt > 0 ? "+" : "−"}${Math.abs(pt).toFixed(2)}pt`;
}

/** 書類の種類の表示名。 */
export function holdingFormLabel(formType: HoldingFormType): string {
  return HOLDING_FORM_LABELS[formType];
}
