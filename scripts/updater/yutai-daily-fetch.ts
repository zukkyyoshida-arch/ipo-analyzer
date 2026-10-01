import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import { CACHE_DIR, REPO_ROOT } from "./config";
import { dailyCoversPreviousMonth } from "./yutai-daily";
import { jstParts, type RawMonthlyQuote } from "./yutai";

// 優待銘柄の日足（Yahoo Finance chart、interval 1d、約 10 年＋1 か月）を用意する。yutai-main.ts から呼ぶ。
// - scripts/updater/.cache/yutai-daily/<code>.json に同じ暦月（JST）に取ったものがあれば使う
// - 無ければ scratch/data-yutai/daily/<code>.json（手元の既存キャッシュ）が前月まで揃っていれば使う
// - どちらも無ければ Yahoo から取る（1 銘柄 1 リクエスト・1 秒以上の間隔・3 回までリトライ・429 は長めに待つ）

/** Yahoo へのリクエスト間隔（ミリ秒）。 */
export const DAILY_INTERVAL_MS = 1000;
const DAILY_RETRIES = 3;
export const DAILY_CACHE_DIR = path.join(CACHE_DIR, "yutai-daily");
const SCRATCH_DAILY_DIR = path.join(REPO_ROOT, "scratch", "data-yutai", "daily");

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DailyCache {
  /** 取得時刻（ISO） */
  fetchedAt: string;
  quotes: RawMonthlyQuote[];
}

export type DailySource = "cache" | "scratch" | "yahoo";

async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function sameJstMonth(a: Date, b: Date): boolean {
  const x = jstParts(a);
  const y = jstParts(b);
  return x.year === y.year && x.month === y.month;
}

/** 429（Too Many Requests）らしいエラーか。 */
function isRateLimited(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /429|Too Many Requests/i.test(msg);
}

/** Yahoo から日足を取る（失敗したら最大 3 回リトライ。429 は 30 秒×回数だけ待つ）。 */
async function fetchDaily(code: string, now: Date): Promise<RawMonthlyQuote[]> {
  // 1 月権利の最古の年は前年 12 月に買うので、11 年前の 11 月から取る
  const period1 = new Date(Date.UTC(jstParts(now).year - 11, 10, 1));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= DAILY_RETRIES; attempt++) {
    if (attempt > 0) await sleep(isRateLimited(lastErr) ? 30_000 * attempt : 3000 * attempt);
    try {
      const chart = await yf.chart(`${code}.T`, { period1, period2: now, interval: "1d" });
      // 出来高は使わないので保存しない（キャッシュを小さくする）
      return chart.quotes.map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        adjclose: q.adjclose,
      }));
    } catch (err) {
      lastErr = err;
      if (attempt < DAILY_RETRIES) {
        console.warn(`  日足の取得失敗（${attempt + 1} 回目）: ${code} — ${(err as Error).message}`);
      }
    }
  }
  throw lastErr;
}

/** 1 銘柄の日足を返す（キャッシュ優先）。取れなければ null。 */
export async function loadDaily(
  code: string,
  now: Date,
): Promise<{ quotes: RawMonthlyQuote[]; source: DailySource } | null> {
  const cachePath = path.join(DAILY_CACHE_DIR, `${code}.json`);
  const cached = await readJsonFile<DailyCache>(cachePath);
  if (cached && Array.isArray(cached.quotes) && sameJstMonth(new Date(cached.fetchedAt), now)) {
    return { quotes: cached.quotes, source: "cache" };
  }
  const scratch = await readJsonFile<RawMonthlyQuote[]>(path.join(SCRATCH_DAILY_DIR, `${code}.json`));
  if (Array.isArray(scratch) && dailyCoversPreviousMonth(scratch, now)) {
    return { quotes: scratch, source: "scratch" };
  }
  try {
    const quotes = await fetchDaily(code, now);
    const body: DailyCache = { fetchedAt: now.toISOString(), quotes };
    await writeFile(cachePath, JSON.stringify(body), "utf-8");
    return { quotes, source: "yahoo" };
  } catch (err) {
    console.warn(`  日足を取得できずスキップ: ${code} — ${(err as Error)?.message}`);
    return null;
  }
}

/**
 * codes の日足を順に用意し、1 銘柄ずつ onQuotes に渡す（逐次・Yahoo へ取りに行ったときだけ 1 秒あける）。
 * 全銘柄の日足を同時にメモリに持たないよう、集計は onQuotes の中で済ませる。
 * 最初に対象数と見込み時間（当月キャッシュの無い銘柄 × 約 1.5 秒）をログに出す。
 */
export async function loadDailyAll(
  codes: string[],
  now: Date,
  onQuotes: (code: string, quotes: RawMonthlyQuote[]) => void,
): Promise<{ count: Record<DailySource, number>; failed: string[] }> {
  await mkdir(DAILY_CACHE_DIR, { recursive: true });
  // 見込み時間: 当月のキャッシュが無い銘柄を数える（scratch で済むものも含めた上限の目安）
  let missing = 0;
  for (const code of codes) {
    const c = await readJsonFile<DailyCache>(path.join(DAILY_CACHE_DIR, `${code}.json`));
    if (!c || !sameJstMonth(new Date(c.fetchedAt), now)) missing++;
  }
  console.log(
    `日足を用意します（${codes.length} 銘柄・当月キャッシュ無し ${missing} 銘柄・見込み 約 ${Math.ceil((missing * 1.5) / 60)} 分）`,
  );
  const count: Record<DailySource, number> = { cache: 0, scratch: 0, yahoo: 0 };
  const failed: string[] = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const got = await loadDaily(code, now);
    if (got) {
      count[got.source]++;
      onQuotes(code, got.quotes);
      if (got.source === "yahoo") await sleep(DAILY_INTERVAL_MS);
    } else {
      failed.push(code);
      await sleep(DAILY_INTERVAL_MS);
    }
    if ((i + 1) % 100 === 0) {
      console.log(`  日足 ${i + 1}/${codes.length}（Yahoo ${count.yahoo}・失敗 ${failed.length}）`);
    }
  }
  return { count, failed };
}
