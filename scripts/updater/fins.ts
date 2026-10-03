import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { addDaysIso } from "../../src/lib/date";
import { buildFinsFile, parseFinsFile } from "../../src/lib/fins/file";
import type { FinsFile, FinsRawRow } from "../../src/types/fins";
import { CACHE_DIR, HTTP_TIMEOUT_MS, USER_AGENT } from "./config";
import { readJson, writeJsonIfChanged } from "./io";

// J-Quants V2 の財務サマリ（/fins/summary）を日付ごとにキャッシュし、fins.json を作る I/O 側。
// 純関数（生行 → fins.json）は src/lib/fins/file.ts。無料枠は 5 回/分・約 12 週遅延。

const BASE_URL = "https://api.jquants.com/v2";
/** 1 リクエストごとの待ち（無料 5 回/分の安全側） */
const WAIT_MS = 13_000;
const RATE_LIMIT_WAIT_MS = 65_000;
/** 無料枠の遅延（日） */
export const FINS_DELAY_DAYS = 84;

export const FINS_CACHE_DIR = path.join(CACHE_DIR, "fins");

/** キャッシュに残す列（fins.json の計算に使う分だけ。生データは大きいので削る）。 */
const KEEP_COLUMNS = [
  "DiscDate", "DiscTime", "DiscNo", "Code", "DocType", "CurPerType", "CurPerSt", "CurPerEn",
  "CurFYSt", "CurFYEn", "NxtFYEn", "Sales", "OP", "OdP", "NP", "EPS", "TA", "Eq", "EqAR", "BPS",
  "CFO", "CFI", "CFF", "CashEq", "FSales", "FOP", "FOdP", "FNP", "FSales2Q", "FOP2Q", "ShOutFY", "TrShFY",
] as const;

export function trimRow(r: Record<string, unknown>): FinsRawRow {
  const out: Record<string, unknown> = {};
  for (const k of KEEP_COLUMNS) if (r[k] !== undefined) out[k] = r[k];
  return out as unknown as FinsRawRow;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheFile = (date: string) => path.join(FINS_CACHE_DIR, `${date}.json`);

/** キャッシュ済みの日付（昇順）。 */
export async function listCachedDates(): Promise<string[]> {
  try {
    return (await readdir(FINS_CACHE_DIR))
      .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
      .filter((d): d is string => !!d)
      .sort();
  } catch {
    return [];
  }
}

async function readCachedDay(date: string): Promise<FinsRawRow[]> {
  const rows = await readJson<unknown>(cacheFile(date), []);
  return Array.isArray(rows) ? (rows as FinsRawRow[]) : [];
}

/** キャッシュ全日分の生行。 */
export async function readAllCachedRows(): Promise<FinsRawRow[]> {
  const out: FinsRawRow[] = [];
  for (const d of await listCachedDates()) out.push(...(await readCachedDay(d)));
  return out;
}

/** 1 行 1 JSON のファイルを日付ごとに分けてキャッシュへ入れる。既にある日付は触らない。戻り値: 書いた日数。 */
export async function seedCacheFromJsonl(jsonlPath: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(jsonlPath, "utf-8");
  } catch {
    return 0;
  }
  const byDate = new Map<string, FinsRawRow[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = trimRow(JSON.parse(line) as Record<string, unknown>);
      if (typeof row.DiscDate !== "string") continue;
      const list = byDate.get(row.DiscDate);
      if (list) list.push(row);
      else byDate.set(row.DiscDate, [row]);
    } catch {
      // 壊れた行は飛ばす
    }
  }
  await mkdir(FINS_CACHE_DIR, { recursive: true });
  const existing = new Set(await listCachedDates());
  let written = 0;
  for (const [date, rows] of byDate) {
    if (existing.has(date)) continue;
    await writeFile(cacheFile(date), JSON.stringify(rows) + "\n", "utf-8");
    written++;
  }
  return written;
}

/** 土日を除いた次の日。 */
export function nextWeekday(iso: string): string {
  let d = addDaysIso(iso, 1);
  for (;;) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return d;
    d = addDaysIso(d, 1);
  }
}

/** 取得対象の日付（キャッシュ最新日の翌平日〜cutoff まで、最大 maxDays 日）。 */
export function planFetchDates(latestCached: string | null, cutoff: string, maxDays: number): string[] {
  const out: string[] = [];
  let d = latestCached ? nextWeekday(latestCached) : nextWeekday(addDaysIso(cutoff, -30));
  while (d <= cutoff && out.length < maxDays) {
    out.push(d);
    d = nextWeekday(d);
  }
  return out;
}

/** 1 日ぶんを取得（pagination を辿る）。400/403/404 は空配列。それ以外のエラーは throw。 */
async function fetchDay(date: string, apiKey: string): Promise<FinsRawRow[]> {
  const out: FinsRawRow[] = [];
  let paginationKey: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ date });
    if (paginationKey) params.set("pagination_key", paginationKey);
    let res: Response;
    for (;;) {
      res = await fetch(`${BASE_URL}/fins/summary?${params}`, {
        headers: { "x-api-key": apiKey, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(Math.max(HTTP_TIMEOUT_MS, 60_000)),
      });
      await sleep(WAIT_MS);
      if (res.status === 429) {
        console.log("429 -> 65 秒待って再試行");
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      break;
    }
    if (res.status === 400 || res.status === 403 || res.status === 404) return out;
    if (!res.ok) throw new Error(`J-Quants /fins/summary ${date}: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, unknown>[]; pagination_key?: string };
    for (const r of json.data ?? []) out.push(trimRow(r));
    paginationKey = json.pagination_key;
    if (!paginationKey) return out;
  }
}

export interface FetchSummary {
  days: number;
  rows: number;
  error: string | null;
}

/** 計画した日付を順に取得してキャッシュへ保存する。失敗したらそこまでで止める（保存済みの分は残る）。 */
export async function fetchAndCache(dates: readonly string[], apiKey: string): Promise<FetchSummary> {
  await mkdir(FINS_CACHE_DIR, { recursive: true });
  const summary: FetchSummary = { days: 0, rows: 0, error: null };
  for (const date of dates) {
    try {
      const rows = await fetchDay(date, apiKey);
      await writeFile(cacheFile(date), JSON.stringify(rows) + "\n", "utf-8");
      summary.days++;
      summary.rows += rows.length;
      console.log(`  ${date}: ${rows.length} 行`);
    } catch (e) {
      summary.error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return summary;
}

/** 生成時刻以外が同じか（同じなら書き換えず、夜間ジョブの差分を増やさない）。 */
export function sameFinsContent(a: FinsFile | null, b: FinsFile): boolean {
  if (!a) return false;
  const strip = (f: FinsFile) => JSON.stringify({ asOf: f.asOf, items: f.items });
  return strip(a) === strip(b);
}

/** fins.json を書く。戻り値: 書いたら true。 */
export async function writeFinsFile(filePath: string, next: FinsFile): Promise<boolean> {
  const current = parseFinsFile(await readJson<unknown>(filePath, null));
  if (sameFinsContent(current, next)) return false;
  return writeJsonIfChanged(filePath, next);
}

export { buildFinsFile };
