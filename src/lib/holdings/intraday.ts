// 大量保有報告書の「日中取得」分（Cloudflare Cron が平日 9〜17 時に毎時 EDINET から取る当日分）の
// 保存形式と、夜間の holdings.json へのマージ。純関数（Date.now を使わない）。
//
// - 取得は worker/intraday-holdings.ts。保存先は既存の KV（PUSH_SUBSCRIPTIONS）で、キーは
//   `holdings:intraday:YYYY-MM-DD`（購読の `sub:`・通知状態の `state:` とは接頭辞で分ける）。TTL は 7 日。
// - 表示側（src/lib/holdings/intradayStore.ts）は直近 HOLDINGS_INTRADAY_READ_DAYS 日分のキーを読み、
//   mergeIntradayHoldings で holdings.json にマージする。夜間ジョブが取り終えた日（coveredThrough 以前）の
//   日中分は使わない（夜間の取得が正）。
// - Worker は fs を使えないので、EDINET コード → 証券コードの写像は夜間ジョブが
//   public/data/holdings-issuers.json（IPO 銘柄の分だけ）に書き出し、Worker は Static Assets から読む。

import type { HoldingsUniverseEntry } from "../edinet/holdingItem";
import { compareHoldingItems, emptyHoldingsFile, parseHoldingsFile } from "./file";
import type { HoldingItem, HoldingsFile } from "./types";

/** 日中取得分の KV キーの接頭辞。 */
export const HOLDINGS_INTRADAY_PREFIX = "holdings:intraday:";
/** 日中取得分の KV の TTL（秒）。夜間の holdings.json に入れば不要になるので数日で消す（7 日）。 */
export const HOLDINGS_INTRADAY_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 表示で読む日数（今日を含む）。夜間ジョブが 1〜2 晩止まっても直近の日中分が見えるように 3 日。 */
export const HOLDINGS_INTRADAY_READ_DAYS = 3;
/** 夜間ジョブが書き出す写像ファイルの名前（public/data/ の下）。 */
export const HOLDINGS_ISSUERS_FILE_NAME = "holdings-issuers.json";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function intradayHoldingsKey(date: string): string {
  return `${HOLDINGS_INTRADAY_PREFIX}${date}`;
}

/** KV に置く 1 日分。 */
export interface IntradayHoldingsState {
  /** 提出日（JST。YYYY-MM-DD） */
  date: string;
  /** 最後に書類一覧を取った時刻（ISO） */
  fetchedAt: string;
  /** 取り込んだ提出（新規・増加に限らず、IPO 銘柄あての全件。訂正は置き換え済み） */
  items: HoldingItem[];
  /** 処理済みの docID（CSV が無い・読めなかったものも含む。次の時間に取り直さない） */
  processedDocIds: string[];
  /** 取り下げられた docID（holdings.json 側からも消す） */
  withdrawnDocIds: string[];
  /** 1 回の上限で次の時間に回した件数 */
  deferred: number;
}

export function emptyIntradayState(date: string): IntradayHoldingsState {
  return { date, fetchedAt: "", items: [], processedDocIds: [], withdrawnDocIds: [], deferred: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** KV の文字列を 1 日分として読む。無い・壊れている・日付が違うときは null。 */
export function parseIntradayState(raw: string | null, date: string): IntradayHoldingsState | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.date !== date || !ISO_DATE.test(date)) return null;
  // 行の検証は holdings.json と同じ規則（形の崩れた行は落とす）
  const parsed = parseHoldingsFile({ items: Array.isArray(data.items) ? data.items : [] });
  const deferred = typeof data.deferred === "number" && data.deferred >= 0 ? Math.floor(data.deferred) : 0;
  return {
    date,
    fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : "",
    items: parsed?.items ?? [],
    processedDocIds: stringList(data.processedDocIds),
    withdrawnDocIds: stringList(data.withdrawnDocIds),
    deferred,
  };
}

/**
 * 夜間の holdings.json に日中取得分を足す。
 * - coveredThrough 以前の日の日中分は使わない（夜間の取得が正）。
 * - 同じ docID は holdings.json 側を残す。取り下げられた docID は両方から消す。
 * - 訂正（amendedFrom あり）は夜間と同じ規則: 訂正前があれば種類・提出日を引き継いで置き換える。
 * 日中分が 1 日も使えなければ file をそのまま返す。
 */
export function mergeIntradayHoldings(
  file: HoldingsFile | null,
  states: readonly IntradayHoldingsState[],
): HoldingsFile | null {
  const covered = file?.coveredThrough ?? "";
  const usable = states
    .filter((s) => ISO_DATE.test(s.date) && (!covered || s.date > covered))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (usable.length === 0) return file;

  const base = file ?? emptyHoldingsFile();
  const items = new Map<string, HoldingItem>();
  for (const it of base.items) items.set(it.docId, it);
  let fetchedAt = "";
  for (const state of usable) {
    for (const id of state.withdrawnDocIds) items.delete(id);
    // 訂正前を先に入れるため、訂正（amendedFrom あり）は後に回す
    const ordered = [...state.items].sort((a, b) => Number(Boolean(a.amendedFrom)) - Number(Boolean(b.amendedFrom)));
    for (const it of ordered) {
      if (items.has(it.docId)) continue;
      const next: HoldingItem = { ...it };
      const parent = next.amendedFrom ? items.get(next.amendedFrom) : undefined;
      if (parent) {
        next.formType = parent.formType;
        next.submitDate = parent.submitDate;
        items.delete(parent.docId);
      }
      items.set(next.docId, next);
    }
    if (state.fetchedAt > fetchedAt) fetchedAt = state.fetchedAt;
  }
  return {
    ...base,
    items: [...items.values()].sort(compareHoldingItems),
    ...(fetchedAt ? { intradayFetchedAt: fetchedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// EDINET コード → IPO 銘柄の写像（public/data/holdings-issuers.json）
// ---------------------------------------------------------------------------

/** 写像の 1 件。 */
export interface HoldingsIssuer extends HoldingsUniverseEntry {
  /** 発行会社の EDINET コード（例 "E12345"） */
  edinetCode: string;
}

/** holdings-issuers.json の中身。 */
export interface HoldingsIssuersFile {
  generatedAt: string;
  items: HoldingsIssuer[];
}

/** IPO 銘柄（universe）のうち EDINET コードが分かるものだけの写像を作る（EDINET コード順）。 */
export function buildHoldingsIssuersFile(
  universe: ReadonlyMap<string, HoldingsUniverseEntry>,
  codeMap: ReadonlyMap<string, string>,
  now: Date,
): HoldingsIssuersFile {
  const items: HoldingsIssuer[] = [];
  for (const [edinetCode, code] of codeMap) {
    const entry = universe.get(code);
    if (!entry) continue;
    items.push({ edinetCode, code: entry.code, name: entry.name, listingDate: entry.listingDate });
  }
  items.sort((a, b) => (a.edinetCode < b.edinetCode ? -1 : a.edinetCode > b.edinetCode ? 1 : 0));
  return { generatedAt: now.toISOString(), items };
}

/** holdings-issuers.json（unknown）を検証する。形が違えば null。形の崩れた行は落とす。 */
export function parseHoldingsIssuersFile(raw: unknown): HoldingsIssuersFile | null {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
  const items: HoldingsIssuer[] = [];
  for (const r of raw.items) {
    if (!isRecord(r)) continue;
    const { edinetCode, code, name, listingDate } = r;
    if (typeof edinetCode !== "string" || !/^E\d{5}$/.test(edinetCode)) continue;
    if (typeof code !== "string" || code === "") continue;
    items.push({
      edinetCode,
      code,
      name: typeof name === "string" && name ? name : code,
      listingDate: typeof listingDate === "string" && ISO_DATE.test(listingDate) ? listingDate : "",
    });
  }
  return { generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "", items };
}

/** 書き出し用の文字列（1 件 1 行）。 */
export function stringifyHoldingsIssuersFile(file: HoldingsIssuersFile): string {
  const items =
    file.items.length === 0
      ? `  "items": []`
      : `  "items": [\n${file.items.map((it) => `    ${JSON.stringify(it)}`).join(",\n")}\n  ]`;
  return `{\n  "generatedAt": ${JSON.stringify(file.generatedAt)},\n${items}\n}\n`;
}
