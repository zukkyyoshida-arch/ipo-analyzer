import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import type { YutaiIndexFile, YutaiMonthFile } from "../../src/lib/yutai/types";
import { CACHE_DIR, FILES, HTTP_TIMEOUT_MS, REPO_ROOT, USER_AGENT } from "./config";
import { readJson } from "./io";
import {
  buildYutaiFile,
  coversPreviousMonth,
  jstDateIso,
  jstParts,
  parseYutaiListPage,
  sameExceptGeneratedAt,
  serializeYutaiIndexFile,
  serializeYutaiMonthFile,
  splitYutaiFile,
  toMonthBars,
  uniqueRows,
  yutaiListPageUrl,
  type MonthBar,
  type RawMonthlyQuote,
  type YutaiListRow,
  type YutaiMonthList,
} from "./yutai";

// 株主優待の先回り買いデータ（public/data/yutai/index.json と権利確定月ごとの <M>.json）を作り直す。
// 実行: npm run yutai:data （-- --force で当月取得済みでも作り直す）
//
// 流れ:
//   1. 大和IR 株主優待ガイドの一覧を権利確定月 1〜12 で取る（1.5 秒間隔の逐次・3 回リトライ）
//   2. 全月の銘柄コードをユニークにし、Yahoo Finance の月足（過去 11 年）を取る（400ms 間隔の逐次）
//      - scripts/updater/.cache/yutai-monthly/<code>.json に同じ暦月（JST）に取ったものがあれば使う
//      - 無ければ scratch/data-yutai/monthly/<code>.json（手元の既存キャッシュ）が前月まで揃っていれば使う
//      - どちらも無ければ Yahoo から取り、.cache に保存する
//   3. 権利確定月ごとに前月の月足を集計して yutai/<M>.json と index.json を書く（generatedAt 以外が同じなら書かない）
//
// 月足は月末にしか変わらないので、--force 無しのときは yutai/index.json の asOf が今月なら何もしない。

const LIST_INTERVAL_MS = 1500;
const YAHOO_INTERVAL_MS = 400;
const LIST_RETRIES = 3;
const MONTHLY_CACHE_DIR = path.join(CACHE_DIR, "yutai-monthly");
const SCRATCH_MONTHLY_DIR = path.join(REPO_ROOT, "scratch", "data-yutai", "monthly");

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 一覧ページを 1 枚取る（失敗したら間隔をあけて最大 3 回リトライ）。 */
async function fetchHtml(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= LIST_RETRIES + 1; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt <= LIST_RETRIES) {
        console.warn(`  取得失敗（${attempt} 回目）: ${url} — ${(err as Error).message}。リトライします`);
        await sleep(5000 * attempt);
      }
    }
  }
  throw new Error(`一覧を取得できませんでした: ${url} — ${(lastErr as Error)?.message}`);
}

/** 権利確定月 M の一覧を全ページ取る。 */
async function fetchMonthList(month: number): Promise<YutaiListRow[]> {
  const first = parseYutaiListPage(await fetchHtml(yutaiListPageUrl(month, 1)));
  const rows = [...first.rows];
  for (let page = 2; page <= first.maxPage; page++) {
    await sleep(LIST_INTERVAL_MS);
    rows.push(...parseYutaiListPage(await fetchHtml(yutaiListPageUrl(month, page))).rows);
  }
  const unique = uniqueRows(rows);
  const note =
    first.totalCount !== null && first.totalCount !== unique.length ? `（サイト表記は全 ${first.totalCount} 件）` : "";
  console.log(`  ${month} 月: ${first.maxPage} ページ・${unique.length} 銘柄${note}`);
  return unique;
}

interface MonthlyCache {
  /** 取得時刻（ISO） */
  fetchedAt: string;
  quotes: RawMonthlyQuote[];
}

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

type MonthlySource = "cache" | "scratch" | "yahoo";

/** 1 銘柄の月足を返す（キャッシュ優先）。取れなければ null。 */
async function loadMonthly(code: string, now: Date): Promise<{ quotes: RawMonthlyQuote[]; source: MonthlySource } | null> {
  const cachePath = path.join(MONTHLY_CACHE_DIR, `${code}.json`);
  const cached = await readJsonFile<MonthlyCache>(cachePath);
  if (cached && Array.isArray(cached.quotes) && sameJstMonth(new Date(cached.fetchedAt), now)) {
    return { quotes: cached.quotes, source: "cache" };
  }
  const scratch = await readJsonFile<RawMonthlyQuote[]>(path.join(SCRATCH_MONTHLY_DIR, `${code}.json`));
  if (Array.isArray(scratch) && coversPreviousMonth(scratch, now)) {
    return { quotes: scratch, source: "scratch" };
  }

  const period1 = new Date(Date.UTC(jstParts(now).year - 11, 0, 1));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chart = await yf.chart(`${code}.T`, { period1, period2: now, interval: "1mo" });
      const quotes: RawMonthlyQuote[] = chart.quotes.map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        // 配当・分割の補正に使う（toMonthBars）
        adjclose: q.adjclose,
      }));
      const body: MonthlyCache = { fetchedAt: now.toISOString(), quotes };
      await writeFile(cachePath, JSON.stringify(body), "utf-8");
      return { quotes, source: "yahoo" };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(2000);
    }
  }
  console.warn(`  月足を取得できずスキップ: ${code} — ${(lastErr as Error)?.message}`);
  return null;
}

/** 権利確定月 M の月別ファイルのパス。 */
function monthPath(month: number): string {
  return path.join(FILES.yutaiDir, `${month}.json`);
}

/** generatedAt 以外が既存ファイルと同じなら書かない。書いたら true。 */
async function writeIfChangedExceptGeneratedAt(
  filePath: string,
  text: string,
  data: { generatedAt: string },
): Promise<boolean> {
  const current = await readFile(filePath, "utf-8").catch(() => null);
  if (sameExceptGeneratedAt(current, data)) return false;
  await writeFile(filePath, text, "utf-8");
  return true;
}

async function main(): Promise<void> {
  const started = Date.now();
  const now = new Date();
  const force = process.argv.includes("--force");

  const indexPath = path.join(FILES.yutaiDir, "index.json");
  const existingIndex = await readJson<YutaiIndexFile | null>(indexPath, null);
  if (!force && existingIndex?.asOf && existingIndex.asOf.slice(0, 7) === jstDateIso(now).slice(0, 7)) {
    console.log(`yutai:data スキップ（yutai/index.json は今月 ${existingIndex.asOf} に作成済み。作り直すときは -- --force）`);
    return;
  }

  console.log(`yutai:data 開始（${jstDateIso(now)}${force ? "・--force" : ""}）`);

  // 1. 一覧
  console.log("大和IR 株主優待ガイドの一覧を取得します");
  const lists: YutaiMonthList[] = [];
  const reused: number[] = [];
  for (let month = 1; month <= 12; month++) {
    if (month > 1) await sleep(LIST_INTERVAL_MS);
    try {
      lists.push({ month, rows: await fetchMonthList(month) });
    } catch (err) {
      // 1 か月ぶん取れなくても、前回の月別ファイル（yutai/<M>.json）があれば一覧だけ使い回す
      // （前回の items＝月足が取れた銘柄だけが対象になる）
      const prev = await readJson<YutaiMonthFile | null>(monthPath(month), null);
      if (!prev || !Array.isArray(prev.items)) throw err;
      console.warn(`  ${month} 月の一覧を取れなかったため前回の一覧を使います: ${(err as Error).message}`);
      reused.push(month);
      lists.push({
        month,
        rows: prev.items.map((it) => ({
          code: it.code,
          name: it.name,
          minInvest: it.minInvest,
          rightsMonths: it.rightsMonths,
          detailUrl: it.detailUrl,
        })),
      });
    }
  }

  // 2. 月足
  const codes = [...new Set(lists.flatMap((l) => l.rows.map((r) => r.code)))].sort();
  console.log(`月足を用意します（${codes.length} 銘柄）`);
  await mkdir(MONTHLY_CACHE_DIR, { recursive: true });
  const barsByCode = new Map<string, MonthBar[]>();
  const count: Record<MonthlySource, number> = { cache: 0, scratch: 0, yahoo: 0 };
  const failed: string[] = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const got = await loadMonthly(code, now);
    if (got) {
      count[got.source]++;
      barsByCode.set(code, toMonthBars(got.quotes));
      if (got.source === "yahoo") await sleep(YAHOO_INTERVAL_MS);
    } else {
      failed.push(code);
      await sleep(YAHOO_INTERVAL_MS);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${codes.length}（Yahoo ${count.yahoo}・失敗 ${failed.length}）`);
  }

  // 3. 集計・書き込み
  const file = buildYutaiFile(lists, barsByCode, now);
  // 索引（index.json）と権利確定月ごとのファイル（<M>.json）に分けて書く。
  // 月別ファイルは銘柄 1 件を 1 行に詰める。generatedAt 以外が同じなら書かない
  const { index, months } = splitYutaiFile(file);
  await mkdir(FILES.yutaiDir, { recursive: true });
  const sizes: string[] = [];
  let writtenCount = 0;
  let totalBytes = 0;
  for (const m of months) {
    const text = serializeYutaiMonthFile(m);
    if (await writeIfChangedExceptGeneratedAt(monthPath(m.month), text, m)) writtenCount++;
    totalBytes += Buffer.byteLength(text);
    sizes.push(`${m.month}月 ${(Buffer.byteLength(text) / 1024).toFixed(0)}KB`);
  }
  const indexWritten = await writeIfChangedExceptGeneratedAt(indexPath, serializeYutaiIndexFile(index), index);

  console.log("=== yutai:data サマリ ===");
  for (const m of Object.values(file.months)) {
    console.log(`  ${String(m.month).padStart(2)} 月（前月 ${m.prevMonth} 月）: 一覧 ${m.listedCount}・月足あり ${m.items.length}`);
  }
  console.log(
    `月足: キャッシュ ${count.cache}・scratch ${count.scratch}・Yahoo ${count.yahoo}・失敗 ${failed.length}` +
      (failed.length > 0 ? `（${failed.join(", ")}）` : ""),
  );
  if (reused.length > 0) console.log(`前回の一覧を使い回した月: ${reused.join(", ")}`);
  console.log(
    `yutai/ 書き込み: 月別 ${writtenCount}/${months.length} ファイル・index.json ${indexWritten ? "あり" : "なし（変更なし）"}` +
      `・合計 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(`  サイズ: ${sizes.join("・")}`);
  console.log(`所要 ${Math.round((Date.now() - started) / 1000)} 秒`);
}

main().catch((err) => {
  console.error("yutai:data 実行中に致命的エラー:", (err as Error).message);
  process.exitCode = 1;
});
