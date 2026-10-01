import type {
  YutaiCandle,
  YutaiFile,
  YutaiIndexFile,
  YutaiItem,
  YutaiMonth,
  YutaiMonthFile,
} from "../../src/lib/yutai/types";
import { prevMonthOf, yutaiListUrl } from "../../src/lib/yutai/types";

// 株主優待の先回り買いデータ（public/data/yutai/index.json と <M>.json）の純関数群。
// - 大和IR 株主優待ガイドの一覧 HTML のパース
// - Yahoo Finance の月足（chart の quotes）を JST の年月へまとめ直す
// - 権利確定月ごとに「前月の月足」を集計して YutaiFile を組み立てる
// 通信・ファイル入出力は yutai-main.ts 側で行う。

/** 大和IR のサイト（詳細ページ URL の組み立てに使う）。 */
export const DAIWAIR_ORIGIN = "https://yutai-guide.daiwair.co.jp";

/** 集計に使う年数（直近 10 年）。 */
export const YUTAI_YEARS = 10;
/** 「直近 5 年」の年数。 */
export const YUTAI_RECENT_YEARS = 5;

// ---------------------------------------------------------------------------
// 一覧 HTML のパース
// ---------------------------------------------------------------------------

/** 一覧 1 行ぶん（月足を付ける前）。 */
export interface YutaiListRow {
  code: string;
  name: string;
  minInvest: number | null;
  yutaiYield: number | null;
  divYield: number | null;
  totalYield: number | null;
  rightsMonths: number[];
  detailUrl: string;
}

/** 一覧 1 ページのパース結果。 */
export interface YutaiListPage {
  rows: YutaiListRow[];
  /** ページャに出ている最大ページ番号（ページャが無ければ 1） */
  maxPage: number;
  /** 「全 42 件」の件数。見つからなければ null */
  totalCount: number | null;
}

/** HTML エンティティをデコードする（数値参照と主要な名前付き参照）。 */
export function decodeHtmlEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return named[body] ?? m;
  });
}

/** 「4.43%」→ 4.43。「－」「-」など数字が無ければ null。 */
function parsePercent(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** 「315,000.0円」→ 315000。数字が無ければ null。 */
function parseYen(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Math.round(Number(m[0]));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 「5、11月」→ [5, 11]。「毎月」→ 1〜12。 */
export function parseRightsMonths(s: string): number[] {
  if (s.includes("毎月")) return Array.from({ length: 12 }, (_, i) => i + 1);
  const months = new Set<number>();
  for (const m of s.matchAll(/\d+/g)) {
    const v = Number(m[0]);
    if (v >= 1 && v <= 12) months.add(v);
  }
  return [...months].sort((a, b) => a - b);
}

/** 社名から「(株)」「（株）」「㈱」を除いて前後の空白を落とす。 */
export function cleanCompanyName(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/\(株\)|（株）|㈱/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 一覧 1 ページの HTML をパースする。 */
export function parseYutaiListPage(html: string): YutaiListPage {
  const rows: YutaiListRow[] = [];
  const head = /<p><a href="\/stock\/detail\/(\w+)">【(\w+)】(.*?)<\/a><\/p>/g;
  const heads = [...html.matchAll(head)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    // この行の span 群は、次の銘柄名（または末尾）までの範囲にある
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? html.length) : html.length;
    const body = html.slice(start, end);
    const span = (label: string): string | undefined => {
      const m = body.match(new RegExp(`<span>${label}：([^<]*)</span>`));
      return m ? decodeHtmlEntities(m[1]).trim() : undefined;
    };
    const detailCode = h[1];
    rows.push({
      code: h[2],
      name: cleanCompanyName(h[3]),
      minInvest: parseYen(span("最低投資金額")),
      yutaiYield: parsePercent(span("優待利回り")),
      divYield: parsePercent(span("配当利回り")),
      totalYield: parsePercent(span("実質利回り")),
      rightsMonths: parseRightsMonths(span("権利月") ?? ""),
      detailUrl: `${DAIWAIR_ORIGIN}/stock/detail/${detailCode}`,
    });
  }

  let maxPage = 1;
  for (const m of html.matchAll(/page=(\d+)/g)) maxPage = Math.max(maxPage, Number(m[1]));

  const countMatch = html.match(/全\s*([\d,]+)\s*件/) ?? html.match(/([\d,]+)\s*件/);
  const totalCount = countMatch ? Number(countMatch[1].replace(/,/g, "")) : null;

  return { rows, maxPage, totalCount: Number.isFinite(totalCount) ? totalCount : null };
}

/** 権利確定月 M の一覧の N ページ目の URL。 */
export function yutaiListPageUrl(month: number, page: number): string {
  return `${yutaiListUrl(month)}&page=${page}`;
}

// ---------------------------------------------------------------------------
// 月足
// ---------------------------------------------------------------------------

/** Yahoo chart の quotes 1 本（キャッシュの JSON から読むので date は文字列も許す）。 */
export interface RawMonthlyQuote {
  date: string | Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
}

/** JST の年月にまとめ直した月足 1 本。 */
export interface MonthBar {
  year: number;
  month: number;
  open: number;
  high: number | null;
  low: number | null;
  close: number;
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** UTC の時刻を JST にして年・月・日を返す。 */
export function jstParts(d: Date): { year: number; month: number; day: number } {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return { year: j.getUTCFullYear(), month: j.getUTCMonth() + 1, day: j.getUTCDate() };
}

/** 年月の通し番号（比較用）。 */
function ymIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Yahoo の月足 quotes を JST の年月ごとの足にまとめる（古い→新しい）。
 * - 月足の date は「前月末 15:00Z」（= JST の月初）なので、+9 時間してから年月を判定する
 * - 当日のライブ値が別の行で付くことがある（例 "2026-09-30T06:30Z"）。同じ年月の行は
 *   始値=最初の行・終値=最後の行・高値/安値=最大/最小でひとつにまとめる
 * - 始値か終値が無い行は捨てる
 */
export function toMonthBars(quotes: RawMonthlyQuote[]): MonthBar[] {
  const rows = quotes
    .map((q) => ({ t: new Date(q.date), q }))
    .filter(({ t, q }) => Number.isFinite(t.getTime()) && num(q.open) !== null && num(q.close) !== null)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  const out: MonthBar[] = [];
  for (const { t, q } of rows) {
    const { year, month } = jstParts(t);
    const high = num(q.high);
    const low = num(q.low);
    const last = out[out.length - 1];
    if (last && last.year === year && last.month === month) {
      last.close = q.close as number;
      if (high !== null) last.high = last.high === null ? high : Math.max(last.high, high);
      if (low !== null) last.low = last.low === null ? low : Math.min(last.low, low);
      continue;
    }
    out.push({ year, month, open: q.open as number, high, low, close: q.close as number });
  }
  return out;
}

/**
 * 月足のキャッシュ（scratch など、取得日の分からないもの）が「実行日の前月まで揃っている」か。
 * 最後の行の時刻が前月の最終平日 15:00（JST、大引け後）以降なら揃っているとみなす。
 * （前月の途中で取ったキャッシュは前月の足が未完結なので使わない）
 */
export function coversPreviousMonth(quotes: RawMonthlyQuote[], now: Date): boolean {
  const times = quotes.map((q) => new Date(q.date).getTime()).filter((t) => Number.isFinite(t));
  if (times.length === 0) return false;
  const lastT = Math.max(...times);
  const { year, month } = jstParts(now);
  // 前月の最終平日（土日だけ見る。祝日は考えない＝安全側で取り直しになる）
  const lastDay = new Date(Date.UTC(year, month - 1, 0)); // 前月末日（UTC の日付として扱う）
  while (lastDay.getUTCDay() === 0 || lastDay.getUTCDay() === 6) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const lastWeekdayCloseJst = lastDay.getTime() + 15 * 3600 * 1000 - JST_OFFSET_MS;
  return lastT >= lastWeekdayCloseJst;
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

/** 前月の月足の集計結果（YutaiItem の月足まわりの項目）。 */
export type YutaiStats = Pick<
  YutaiItem,
  "candles" | "up10" | "n10" | "up5" | "n5" | "avgRet10" | "avgHighRet10" | "price" | "high12" | "low12"
>;

function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

/**
 * 月足から「前月 prevMonth」の集計を作る。
 * 完結した足だけ使う（実行日の年月 ≥ その足の翌月）。price・high12・low12 は未完結の当月の足も含める。
 */
export function summarizePrevMonth(bars: MonthBar[], prevMonth: number, now: Date): YutaiStats {
  const { year: ny, month: nm } = jstParts(now);
  const nowIdx = ymIndex(ny, nm);
  const done = bars.filter((b) => b.month === prevMonth && ymIndex(b.year, b.month) < nowIdx);
  const last10 = done.slice(-YUTAI_YEARS);
  const last5 = done.slice(-YUTAI_RECENT_YEARS);
  const isUp = (b: MonthBar) => b.close > b.open;
  const candles: YutaiCandle[] = last10.map((b) => ({
    year: b.year,
    open: round(b.open, 1),
    close: round(b.close, 1),
    high: b.high === null ? null : round(b.high, 1),
    low: b.low === null ? null : round(b.low, 1),
  }));
  const rets = last10.filter((b) => b.open > 0).map((b) => b.close / b.open - 1);
  const avgRet10 = rets.length > 0 ? round(rets.reduce((a, b) => a + b, 0) / rets.length, 4) : null;
  // 前月中の高値まで届いた幅（高値/始値 − 1）の平均。高値が無い足は除く
  const highRets = last10
    .filter((b) => b.open > 0 && b.high !== null)
    .map((b) => (b.high as number) / b.open - 1);
  const avgHighRet10 =
    highRets.length > 0 ? round(highRets.reduce((a, b) => a + b, 0) / highRets.length, 4) : null;

  const lastBar = bars[bars.length - 1];
  const recent12 = bars.slice(-12);
  const highs = recent12.map((b) => b.high).filter((v): v is number => v !== null);
  const lows = recent12.map((b) => b.low).filter((v): v is number => v !== null);

  return {
    candles,
    up10: last10.filter(isUp).length,
    n10: last10.length,
    up5: last5.filter(isUp).length,
    n5: last5.length,
    avgRet10,
    avgHighRet10,
    price: lastBar ? round(lastBar.close, 1) : null,
    high12: highs.length > 0 ? round(Math.max(...highs), 1) : null,
    low12: lows.length > 0 ? round(Math.min(...lows), 1) : null,
  };
}

/** 並び順: 陽線割合（up10/n10）降順 → up5 降順 → avgRet10 降順 → コード昇順。 */
export function compareYutaiItems(a: YutaiItem, b: YutaiItem): number {
  const ra = a.n10 > 0 ? a.up10 / a.n10 : -1;
  const rb = b.n10 > 0 ? b.up10 / b.n10 : -1;
  if (rb !== ra) return rb - ra;
  if (b.up5 !== a.up5) return b.up5 - a.up5;
  const aa = a.avgRet10 ?? -Infinity;
  const ab = b.avgRet10 ?? -Infinity;
  if (ab !== aa) return ab - aa;
  return a.code.localeCompare(b.code);
}

/** 権利確定月 1 つぶんの一覧（取得結果）。 */
export interface YutaiMonthList {
  month: number;
  rows: YutaiListRow[];
}

/** JST の今日（YYYY-MM-DD）。 */
export function jstDateIso(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 一覧と月足から YutaiFile を組み立てる。
 * 前月の月足が 1 本も無い銘柄（上場が浅い・月足が取れない）は items に入れない（listedCount には数える）。
 */
export function buildYutaiFile(
  lists: YutaiMonthList[],
  barsByCode: Map<string, MonthBar[]>,
  now: Date,
): YutaiFile {
  const months: Record<string, YutaiMonth> = {};
  for (const { month, rows } of [...lists].sort((a, b) => a.month - b.month)) {
    const prevMonth = prevMonthOf(month);
    const items: YutaiItem[] = [];
    for (const row of rows) {
      const bars = barsByCode.get(row.code);
      if (!bars || bars.length === 0) continue;
      const stats = summarizePrevMonth(bars, prevMonth, now);
      if (stats.n10 === 0) continue;
      items.push({ ...row, ...stats });
    }
    items.sort(compareYutaiItems);
    months[String(month)] = {
      month,
      prevMonth,
      listUrl: yutaiListUrl(month),
      listedCount: rows.length,
      items,
    };
  }
  return { generatedAt: now.toISOString(), asOf: jstDateIso(now), months };
}

/** 一覧の行を銘柄コードで重複排除する（同じ月に 2 回載っていたら最初の行）。 */
export function uniqueRows(rows: YutaiListRow[]): YutaiListRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
}

// ---------------------------------------------------------------------------
// 配信用の分割ファイル（public/data/yutai/index.json と <M>.json）
// ---------------------------------------------------------------------------

/** 全体（YutaiFile）を索引と月別ファイルに分ける。 */
export function splitYutaiFile(file: YutaiFile): {
  index: YutaiIndexFile;
  months: YutaiMonthFile[];
} {
  const months = Object.values(file.months)
    .sort((a, b) => a.month - b.month)
    .map((m): YutaiMonthFile => ({ asOf: file.asOf, generatedAt: file.generatedAt, ...m }));
  const index: YutaiIndexFile = {
    generatedAt: file.generatedAt,
    asOf: file.asOf,
    months: Object.fromEntries(
      months.map((m) => [String(m.month), { listedCount: m.listedCount, itemCount: m.items.length }]),
    ),
  };
  return { index, months };
}

/**
 * 月別ファイルの文字列にする。2 スペース整形だと全体で 4.5MB ほどになるため、
 * 外側は 2 スペース整形のまま、銘柄 1 件（items の要素）だけ 1 行に詰める（差分は「銘柄 1 件 = 1 行」で読める）。
 */
export function serializeYutaiMonthFile(file: YutaiMonthFile): string {
  const { items, ...head } = file;
  const headText = JSON.stringify(head, null, 2);
  // 末尾の "}" の手前に items を足す
  const body = headText.slice(0, headText.lastIndexOf("}")).trimEnd();
  const itemsText =
    items.length === 0
      ? `  "items": []`
      : `  "items": [\n${items.map((it) => `    ${JSON.stringify(it)}`).join(",\n")}\n  ]`;
  return `${body},\n${itemsText}\n}\n`;
}

/** 索引ファイルの文字列（2 スペース整形）。 */
export function serializeYutaiIndexFile(file: YutaiIndexFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/**
 * 既存ファイルの中身（文字列）と新しい中身が generatedAt 以外同じか。
 * 同じなら書かない（毎晩の無駄な差分を出さないため）。既存が読めない・壊れていれば false。
 */
export function sameExceptGeneratedAt<T extends { generatedAt: string }>(currentText: string | null, next: T): boolean {
  if (currentText === null) return false;
  try {
    const cur = JSON.parse(currentText) as { generatedAt?: string };
    return JSON.stringify({ ...cur, generatedAt: "" }) === JSON.stringify({ ...next, generatedAt: "" });
  } catch {
    return false;
  }
}
