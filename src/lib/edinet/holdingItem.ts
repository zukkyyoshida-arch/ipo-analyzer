import type { IpoAuto, IpoBase } from "../../types/data";
import type { HoldingFormType, HoldingItem } from "../holdings/types";
import type { EdinetDocMeta } from "./client";
import { normalizeText, type ParsedHoldingReport } from "./holdingsCsv";

// 大量保有報告書: EDINET の書類一覧 1 件＋CSV から holdings.json の 1 件を作る部分。
// Node の fs に依存しないので、夜間ジョブ（scripts/updater/holdings.ts）と Worker の日中取得
// （worker/intraday-holdings.ts）の両方から使う。

/** formCode → 書類の種類（docTypeCode 350）。 */
export const FORM_TYPES: Record<string, HoldingFormType> = {
  "010000": "new",
  "010002": "change",
  "020002": "bulkTransfer",
  "030000": "newSpecial",
  "030002": "changeSpecial",
};

export const TARGET_DOC_TYPES = new Set(["350", "360"]);

/** 結合に使う IPO 銘柄 1 件。 */
export interface HoldingsUniverseEntry {
  code: string;
  name: string;
  /** 上場日（YYYY-MM-DD。未定は ""） */
  listingDate: string;
}

/** base（手動）を優先し、auto で欠けを埋めて IPO 銘柄の一覧を作る。 */
export function buildHoldingsUniverse(
  base: readonly Pick<IpoBase, "code" | "name" | "listingDate">[],
  auto: readonly Pick<IpoAuto, "code" | "name" | "listingDate">[],
): Map<string, HoldingsUniverseEntry> {
  const out = new Map<string, HoldingsUniverseEntry>();
  for (const b of base) {
    if (!b.code) continue;
    out.set(b.code, { code: b.code, name: b.name || b.code, listingDate: b.listingDate || "" });
  }
  for (const a of auto) {
    if (!a.code) continue;
    const cur = out.get(a.code);
    if (!cur) {
      out.set(a.code, { code: a.code, name: a.name || a.code, listingDate: a.listingDate || "" });
      continue;
    }
    if (!cur.listingDate && a.listingDate) cur.listingDate = a.listingDate;
    if ((cur.name === cur.code || !cur.name) && a.name) cur.name = a.name;
  }
  return out;
}

/** "2026-09-29 09:56" → "2026-09-29"。 */
function submitDateOf(doc: EdinetDocMeta, fallback: string): string {
  const m = (doc.submitDateTime ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

/** 形式コードが分からない・訂正報告書で元が無いときに、CSV の中身から種類を推す。 */
export function inferFormType(parsed: ParsedHoldingReport): HoldingFormType {
  if (parsed.schema.startsWith("02")) return "bulkTransfer";
  const special = parsed.schema.startsWith("03");
  const isNew = parsed.prevRatio === null && parsed.reason === "";
  if (special) return isNew ? "newSpecial" : "changeSpecial";
  return isNew ? "new" : "change";
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** 書類一覧の 1 件と CSV から holdings.json の 1 件を作る。 */
export function buildHoldingItem(
  doc: EdinetDocMeta,
  parsed: ParsedHoldingReport,
  entry: HoldingsUniverseEntry,
  listDate: string,
): HoldingItem {
  const formType =
    doc.docTypeCode === "350" && doc.formCode && FORM_TYPES[doc.formCode]
      ? FORM_TYPES[doc.formCode]
      : inferFormType(parsed);
  const delta =
    parsed.ratio !== null && parsed.prevRatio !== null ? round6(parsed.ratio - parsed.prevRatio) : null;
  return {
    code: entry.code,
    name: entry.name,
    docId: doc.docID,
    submitDate: submitDateOf(doc, listDate),
    filer: normalizeText(doc.filerName ?? "") || parsed.filer,
    ...(parsed.holders !== null && parsed.holders >= 2 ? { holders: parsed.holders } : {}),
    formType,
    ratio: parsed.ratio,
    prevRatio: parsed.prevRatio,
    delta,
    purpose: parsed.purpose,
    ...(parsed.proposal ? { proposal: true } : {}),
    shares: parsed.shares,
    reason: parsed.reason,
    obligationDate: parsed.obligationDate,
    ...(entry.listingDate ? { listingDate: entry.listingDate } : {}),
  };
}


/** 同じ docID が 2 行ある（書類情報の修正前後）ときは修正後だけを残す。修正前（"2"）は捨てる。 */
export function normalizeDocs(docs: readonly EdinetDocMeta[]): EdinetDocMeta[] {
  const byId = new Map<string, EdinetDocMeta>();
  for (const d of docs) {
    if (!d || typeof d.docID !== "string" || d.docID === "") continue;
    if (d.docInfoEditStatus === "2") continue;
    byId.set(d.docID, d);
  }
  return [...byId.values()];
}

/** 350 を先、360 を後。同じ種類の中は提出時刻 → docID の順。 */
export function compareForProcessing(a: EdinetDocMeta, b: EdinetDocMeta): number {
  const ta = a.docTypeCode === "360" ? 1 : 0;
  const tb = b.docTypeCode === "360" ? 1 : 0;
  if (ta !== tb) return ta - tb;
  const sa = a.submitDateTime ?? "";
  const sb = b.submitDateTime ?? "";
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.docID < b.docID ? -1 : a.docID > b.docID ? 1 : 0;
}
