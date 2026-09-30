import { addDaysIso } from "@/lib/date";
import { compareHoldingItems, parseHoldingsFile } from "@/lib/holdings/file";
import type { HoldingsFile } from "@/lib/holdings/types";

// 大量保有報告書の日中取得（平日 9:00〜17:00 JST の毎時、Worker の Cron が当日分を取って KV に置く）と、
// 夜間の holdings.json を重ねる純関数。
//
// - KV の値は holdings.json と同じ形（coveredFrom = coveredThrough = 当日、generatedAt = 取得時刻）。
//   読むときは parseHoldingsFile で検証する。
// - キーは当日（JST）の日付ごと。夜間ジョブが holdings.json に取り込めば不要になるので、TTL 48 時間で自然に消える。
// - 重ねるのは「holdings.json がまだ取り込んでいない日」の分だけ。docID が同じものは holdings.json を正とし、
//   日中に出た訂正報告書が holdings.json の書類を訂正していれば、訂正前の 1 件を外す。

/** KV（HOLDINGS_INTRADAY）のキーの接頭辞。 */
export const HOLDINGS_INTRADAY_KEY_PREFIX = "intraday:";
/** KV の値の寿命（秒）。夜間ジョブが取り込むまでもてばよい。 */
export const HOLDINGS_INTRADAY_TTL_SECONDS = 48 * 60 * 60;

/** その日（JST、YYYY-MM-DD）の日中分のキー。 */
export function intradayHoldingsKey(dateIso: string): string {
  return `${HOLDINGS_INTRADAY_KEY_PREFIX}${dateIso}`;
}

/** KV の文字列を読む。無い・壊れている・日付が無いときは null。 */
export function parseIntradayHoldings(raw: string | null): HoldingsFile | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const file = parseHoldingsFile(json);
  if (!file || !file.coveredThrough) return null;
  return file;
}

/**
 * holdings.json（夜間）に日中分を重ねる。日中分が無い・holdings.json が既にその日を取り込んでいるときは file をそのまま返す。
 * coveredThrough は、holdings.json が前日まで取り終えているときだけ日中分の日付へ進める（夜間が止まっているときの
 * 「更新待ち」表示を隠さない）。
 */
export function mergeIntradayHoldings(file: HoldingsFile | null, intraday: HoldingsFile | null): HoldingsFile | null {
  if (!intraday || !intraday.coveredThrough) return file;
  const day = intraday.coveredThrough;
  if (file && file.coveredThrough >= day) return file;

  const baseItems = file?.items ?? [];
  const known = new Set(baseItems.map((it) => it.docId));
  const amended = new Set(intraday.items.map((it) => it.amendedFrom).filter((id): id is string => Boolean(id)));
  const added = intraday.items.filter((it) => !known.has(it.docId));
  const items = [...baseItems.filter((it) => !amended.has(it.docId)), ...added].sort(compareHoldingItems);

  const continuous = !file || !file.coveredThrough || file.coveredThrough >= addDaysIso(day, -1);
  return {
    generatedAt: file?.generatedAt ?? intraday.generatedAt,
    coveredFrom: file?.coveredFrom || intraday.coveredFrom,
    coveredThrough: continuous ? day : (file?.coveredThrough ?? ""),
    source: file?.source ?? intraday.source,
    items,
    intradayAt: intraday.generatedAt,
  };
}

/** 取得時刻（ISO）を JST の「14:05」にする。読めなければ ""。 */
export function formatIntradayTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}
