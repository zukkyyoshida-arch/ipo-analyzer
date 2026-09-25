import { BB_STATUS_ORDER, type BbStatus } from "@/types/broker";
import type { BbEntry, BbState, NotesState } from "@/types/userData";
import type { SyncData } from "./types";

// 端末間同期のマージ（純関数）。既存データに項目ごとの updatedAt が無いため、
// 「前回同期時のスナップショット（base）との差分」でローカルの変更を検知する。
// - ローカルが base から変わった項目 → ローカル優先（削除も含む）
// - 変わっていない項目 → リモート優先（リモートでの追加・変更・削除を取り込む）
// 項目の単位: ウォッチ=銘柄コード、BB記録=銘柄コード×証券会社、メモ=銘柄コード。

export const EMPTY_SYNC_DATA: SyncData = { watchlist: [], bb: {}, notes: {} };

const BB_STATUSES = new Set<string>(BB_STATUS_ORDER);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** BB 記録 1 件を正規化する。「未対応」かつメモ無しは記録なしと同じなので null。 */
function normalizeBbEntry(value: unknown): BbEntry | null {
  if (!isRecord(value)) return null;
  const status = typeof value.status === "string" && BB_STATUSES.has(value.status)
    ? (value.status as BbStatus)
    : "none";
  const memo = typeof value.memo === "string" && value.memo !== "" ? value.memo : undefined;
  if (status === "none" && memo === undefined) return null;
  return memo === undefined ? { status } : { status, memo };
}

/**
 * 不明な値を SyncData に正規化する（壊れた値・余計な値は捨てる）。
 * 空のメモ・「未対応」かつメモ無しの BB 記録は「無し」とみなして落とす。
 */
export function normalizeSyncData(value: unknown): SyncData {
  if (!isRecord(value)) return { watchlist: [], bb: {}, notes: {} };

  const watchlist: string[] = [];
  if (Array.isArray(value.watchlist)) {
    for (const code of value.watchlist) {
      if (typeof code === "string" && code !== "" && !watchlist.includes(code)) {
        watchlist.push(code);
      }
    }
  }

  const bb: BbState = {};
  if (isRecord(value.bb)) {
    for (const [code, brokers] of Object.entries(value.bb)) {
      if (!isRecord(brokers)) continue;
      const forCode: Record<string, BbEntry> = {};
      for (const [brokerId, raw] of Object.entries(brokers)) {
        const entry = normalizeBbEntry(raw);
        if (entry) forCode[brokerId] = entry;
      }
      if (Object.keys(forCode).length > 0) bb[code] = forCode;
    }
  }

  const notes: NotesState = {};
  if (isRecord(value.notes)) {
    for (const [code, text] of Object.entries(value.notes)) {
      if (typeof text === "string" && text !== "") notes[code] = text;
    }
  }

  return { watchlist, bb, notes };
}

/** サーバー受信用: 形が SyncData として妥当か（配列・オブジェクトの型だけを見る）。 */
export function isSyncDataShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.watchlist) &&
    isRecord(value.bb) &&
    isRecord(value.notes)
  );
}

function sameEntry(a: BbEntry | undefined, b: BbEntry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.status === b.status && (a.memo ?? "") === (b.memo ?? "");
}

function mergeWatchlist(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base);
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const keep = (code: string): boolean => {
    const localHas = localSet.has(code);
    const localChanged = localHas !== baseSet.has(code);
    return localChanged ? localHas : remoteSet.has(code);
  };
  // 並びはローカル順 → リモートにだけある銘柄を後ろに足す。
  const result = local.filter(keep);
  for (const code of remote) {
    if (!localSet.has(code) && keep(code)) result.push(code);
  }
  return result;
}

function mergeBb(base: BbState, local: BbState, remote: BbState): BbState {
  const result: BbState = {};
  const codes = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  for (const code of codes) {
    const brokerIds = new Set([
      ...Object.keys(local[code] ?? {}),
      ...Object.keys(remote[code] ?? {}),
      ...Object.keys(base[code] ?? {}),
    ]);
    const forCode: Record<string, BbEntry> = {};
    for (const brokerId of brokerIds) {
      const b = base[code]?.[brokerId];
      const l = local[code]?.[brokerId];
      const r = remote[code]?.[brokerId];
      const picked = sameEntry(l, b) ? r : l;
      if (picked) forCode[brokerId] = picked;
    }
    if (Object.keys(forCode).length > 0) result[code] = forCode;
  }
  return result;
}

function mergeNotes(base: NotesState, local: NotesState, remote: NotesState): NotesState {
  const result: NotesState = {};
  const codes = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  for (const code of codes) {
    const l = local[code];
    const picked = l === base[code] ? remote[code] : l;
    if (picked !== undefined) result[code] = picked;
  }
  return result;
}

/**
 * 3 者マージ。base が null（この端末で初回の同期）のときは空を base とみなすため、
 * 両方にある項目はローカル優先、リモートにだけある項目は取り込む（和集合）。
 * remote が null（サーバーに未保存）のときはローカルをそのまま返す。
 * @param base 前回同期時のスナップショット
 * @param local 端末の現在のデータ
 * @param remote サーバーのデータ
 */
export function mergeSyncData(
  base: SyncData | null,
  local: SyncData,
  remote: SyncData | null,
): SyncData {
  const l = normalizeSyncData(local);
  if (remote === null) return l;
  const b = normalizeSyncData(base ?? EMPTY_SYNC_DATA);
  const r = normalizeSyncData(remote);
  return {
    watchlist: mergeWatchlist(b.watchlist, l.watchlist, r.watchlist),
    bb: mergeBb(b.bb, l.bb, r.bb),
    notes: mergeNotes(b.notes, l.notes, r.notes),
  };
}

/** 正規化したうえで同じ内容か（ウォッチの並び順も比較する）。 */
export function isSameSyncData(a: SyncData | null, b: SyncData | null): boolean {
  if (a === null || b === null) return a === b;
  return stableStringify(normalizeSyncData(a)) === stableStringify(normalizeSyncData(b));
}

/** キー順を揃えた JSON 文字列（比較用）。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
