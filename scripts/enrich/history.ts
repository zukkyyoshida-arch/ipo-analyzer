import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HistoricalIpo } from "../../src/types/history";
import { DATA_DIR, REPO_ROOT, REQUEST_INTERVAL_MS } from "./config";
import { parse96utHistorical } from "./parse96ut";
import {
  articleNumberFromUrl,
  collectAllIpoArticleUrls,
  politeFetchText,
  sleep as defaultSleep,
  type FetchText,
} from "./sitemap";

// enrich:history。96ut の 2015〜2023 年の IPO 記事を取得し、圧縮した履歴データを書き出す。
// 出力: public/data/ipos.history.json（配列・上場日昇順）と scratch/backtest/data/ipo_history.csv（同じ列）。
// 2024 年以降は ipos.enriched.json 側に任せるため対象外。1 req/秒・失敗はスキップ。

export const HISTORY_FILES = {
  json: path.join(DATA_DIR, "ipos.history.json"),
  csv: path.join(REPO_ROOT, "scratch", "backtest", "data", "ipo_history.csv"),
} as const;

/** 途中保存の間隔（取得件数）。 */
export const HISTORY_FLUSH_EVERY = 100;

/** 記事番号の年（先頭4桁）が from〜to のURLだけを記事番号昇順で返す。 */
export function selectHistoryUrls(urls: string[], fromYear: number, toYear: number): string[] {
  return urls
    .map((u) => ({ u, num: articleNumberFromUrl(u) }))
    .filter((x): x is { u: string; num: string } => {
      if (!x.num) return false;
      const year = Number(x.num.slice(0, 4));
      return year >= fromYear && year <= toYear;
    })
    .sort((a, b) => a.num.localeCompare(b.num))
    .map((x) => x.u);
}

/** code 重複は記事番号の新しい方を優先し、上場日昇順（同日は code 昇順）で返す。 */
export function dedupeHistory(records: HistoricalIpo[]): HistoricalIpo[] {
  const num = (r: HistoricalIpo) => articleNumberFromUrl(r.sourceUrl) ?? "";
  const map = new Map<string, HistoricalIpo>();
  for (const r of records) {
    const prev = map.get(r.code);
    if (!prev || num(r) >= num(prev)) map.set(r.code, r);
  }
  return Array.from(map.values()).sort(
    (a, b) => a.listingDate.localeCompare(b.listingDate) || a.code.localeCompare(b.code),
  );
}

/**
 * 株式の IPO か（REIT・インフラファンド等の投資法人は除く）。
 * 投資口は価格帯・OR・吸収金額の水準が株式と別物で、統計を歪めるため履歴に入れない。
 */
export function isStockIpo(record: Pick<HistoricalIpo, "name">): boolean {
  return !/投資法人|インフラファンド|ETF|ETN/.test(record.name);
}

/** CSV の列（priceRange は low/high の2列に展開）。 */
export const HISTORY_CSV_COLUMNS = [
  "code",
  "name",
  "market",
  "listingDate",
  "offeringPrice",
  "initialPrice",
  "assumedPrice",
  "priceRangeLow",
  "priceRangeHigh",
  "absorptionAmount",
  "marketCap",
  "offeringRatio",
  "saleRatio",
  "publicShares",
  "saleShares",
  "overAllotment",
  "leadUnderwriter",
  "underwriterCount",
  "vcRatio",
  "lockupDays",
  "lockupHasPriceRelease",
  "lockupCoverage",
  "revenueGrowth",
  "isProfitable",
  "sourceUrl",
  "fetchedAt",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 履歴レコードを CSV 文字列にする（null は空セル）。 */
export function historyToCsv(records: HistoricalIpo[]): string {
  const lines = [HISTORY_CSV_COLUMNS.join(",")];
  for (const r of records) {
    const row: Record<string, unknown> = {
      ...r,
      priceRangeLow: r.priceRange?.low ?? null,
      priceRangeHigh: r.priceRange?.high ?? null,
    };
    lines.push(HISTORY_CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** JSON は1行1レコード（差分が読みやすく、容量も抑える）。 */
export function historyToJson(records: HistoricalIpo[]): string {
  if (records.length === 0) return "[]\n";
  return "[\n" + records.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";
}

export interface RunHistoryOptions {
  fromYear: number;
  toYear: number;
  fetchText?: FetchText;
  sleep?: (ms: number) => Promise<void>;
  now?: () => string;
  warn?: (message: string) => void;
  log?: (message: string) => void;
  /** 記事URLの収集（既定はサイトマップ）。 */
  collectUrls?: () => Promise<string[]>;
  /** 途中保存・最終保存（既定はファイル書き込み）。 */
  save?: (records: HistoricalIpo[]) => Promise<void>;
  /** 途中保存の間隔（取得件数）。既定は HISTORY_FLUSH_EVERY（100）。テストで少ない件数を試すために注入できる。 */
  flushEvery?: number;
}

export interface HistorySummary {
  targetCount: number;
  successCount: number;
  /** REIT 等を除いた件数。 */
  excludedCount: number;
  failedUrls: string[];
  records: HistoricalIpo[];
}

/** 既定の保存処理（JSON と CSV の両方）。 */
export async function saveHistoryFiles(records: HistoricalIpo[]): Promise<void> {
  await mkdir(path.dirname(HISTORY_FILES.csv), { recursive: true });
  await writeFile(HISTORY_FILES.json, historyToJson(records), "utf-8");
  await writeFile(HISTORY_FILES.csv, historyToCsv(records), "utf-8");
}

/** 収集→取得→パース→重複排除→保存（flushEvery 件ごとに途中保存。既定は HISTORY_FLUSH_EVERY）。 */
export async function runHistory(options: RunHistoryOptions): Promise<HistorySummary> {
  const fetchText = options.fetchText ?? politeFetchText;
  const wait = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  const warn = options.warn ?? console.warn;
  const log = options.log ?? (() => {});
  const save = options.save ?? saveHistoryFiles;
  const flushEvery = options.flushEvery ?? HISTORY_FLUSH_EVERY;
  const collect =
    options.collectUrls ??
    (() => collectAllIpoArticleUrls({ fetchText, sleep: wait, warn }));

  const targets = selectHistoryUrls(await collect(), options.fromYear, options.toYear);
  log(`[history] 対象 ${targets.length}件（${options.fromYear}〜${options.toYear}）`);
  const fresh: HistoricalIpo[] = [];
  const failedUrls: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    if (i > 0) await wait(REQUEST_INTERVAL_MS);
    try {
      const { text, url: finalUrl } = await fetchText(url);
      if (articleNumberFromUrl(finalUrl) !== articleNumberFromUrl(url)) {
        warn(`[history] リダイレクトのためスキップ: ${url} → ${finalUrl}`);
        failedUrls.push(url);
      } else {
        const rec = parse96utHistorical(text, url, now());
        if (rec) {
          fresh.push(rec);
          log(`[history] ${i + 1}/${targets.length} ${rec.code} ${rec.listingDate} ${url}`);
        } else {
          warn(`[history] コードまたは上場日を抽出できないためスキップ: ${url}`);
          failedUrls.push(url);
        }
      }
    } catch (e) {
      warn(`[history] 取得失敗のためスキップ: ${url} (${String(e)})`);
      failedUrls.push(url);
    }
    if ((i + 1) % flushEvery === 0 && fresh.length > 0) {
      await save(dedupeHistory(fresh).filter(isStockIpo));
    }
  }

  const records = dedupeHistory(fresh).filter(isStockIpo);
  if (records.length > 0) await save(records);
  const excludedCount = dedupeHistory(fresh).length - records.length;
  return { targetCount: targets.length, successCount: fresh.length, excludedCount, failedUrls, records };
}

/** "--from 2015 --to 2023" を読む。無ければ既定（2015〜2023）。 */
export function parseHistoryArgs(argv: string[]): { fromYear: number; toYear: number } {
  const value = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    const n = i >= 0 ? Number(argv[i + 1]) : NaN;
    return Number.isInteger(n) ? n : fallback;
  };
  return { fromYear: value("--from", 2015), toYear: value("--to", 2023) };
}

/** 年別・市場別件数と主要項目の欠損率（%）。 */
export function summarizeHistory(records: HistoricalIpo[]): {
  byYear: Record<string, number>;
  byMarket: Record<string, number>;
  missingRate: Record<string, number>;
} {
  const byYear: Record<string, number> = {};
  const byMarket: Record<string, number> = {};
  for (const r of records) {
    const y = r.listingDate.slice(0, 4);
    byYear[y] = (byYear[y] ?? 0) + 1;
    const m = r.market ?? "その他";
    byMarket[m] = (byMarket[m] ?? 0) + 1;
  }
  const keys = ["offeringPrice", "initialPrice", "absorptionAmount", "offeringRatio", "saleRatio"] as const;
  const missingRate: Record<string, number> = {};
  for (const k of keys) {
    const missing = records.filter((r) => r[k] === null).length;
    missingRate[k] = records.length === 0 ? 0 : Math.round((missing / records.length) * 1000) / 10;
  }
  return { byYear, byMarket, missingRate };
}

/** CLI（main.ts の --history から呼ぶ）。 */
export async function historyMain(argv: string[]): Promise<void> {
  const { fromYear, toYear } = parseHistoryArgs(argv);
  const summary = await runHistory({ fromYear, toYear, log: (m) => console.log(m) });
  const stats = summarizeHistory(summary.records);
  console.log("=== enrich:history サマリ ===");
  console.log(`対象: ${summary.targetCount}件 / 成功: ${summary.successCount}件 / 失敗: ${summary.failedUrls.length}件`);
  console.log(`重複排除・REIT等除外後: ${summary.records.length}件（除外 ${summary.excludedCount}件）`);
  console.log(`年別: ${JSON.stringify(stats.byYear)}`);
  console.log(`市場別: ${JSON.stringify(stats.byMarket)}`);
  console.log(`欠損率(%): ${JSON.stringify(stats.missingRate)}`);
  if (summary.failedUrls.length > 0) console.log(`失敗URL:\n  ${summary.failedUrls.join("\n  ")}`);
}
