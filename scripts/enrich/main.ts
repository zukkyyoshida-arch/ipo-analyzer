import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { IpoAuto, IpoBase } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import { mergeIpos } from "../../src/lib/merge";
import { assessCompleteness } from "../../src/lib/completeness";
import { FILES, REQUEST_INTERVAL_MS } from "./config";
import { parse96utArticleWithDiagnostics } from "./parse96ut";
import {
  articleNumberFromUrl,
  collectAllIpoArticleUrls,
  politeFetchText,
  sleep as defaultSleep,
  type FetchText,
} from "./sitemap";

// enrich:data エントリポイント。96ut の IPO 記事を取得して public/data/ipos.enriched.json を差分更新する。
// 1) サイトマップで記事URL収集 → 2) 対象を絞る（取得済みの上場済み銘柄はスキップ）
// → 3) 1 req/秒で取得 → 4) パース → 5) code 単位で upsert（削除なし）→ 6) サマリ出力。

/** 取得対象の選別結果。 */
export interface TargetSelection {
  targets: string[];
  /** 取得済み・上場済みのためスキップしたURL。 */
  skipped: string[];
}

/**
 * その銘柄が「上場済み」か。base/auto の status が listed、または上場日が今日以前、
 * または（base/auto に無い銘柄で）enriched に初値ベースの吸収金額がある場合に true。
 */
export function isListedCode(
  code: string,
  base: IpoBase[],
  auto: IpoAuto[],
  existing: IpoEnriched | undefined,
  todayIso: string,
): boolean {
  const a = auto.find((x) => x.code === code);
  const b = base.find((x) => x.code === code);
  const status = a?.status ?? b?.status;
  if (status === "listed") return true;
  const listingDate = a?.listingDate || b?.listingDate || "";
  if (listingDate !== "" && listingDate <= todayIso) return true;
  if (!a && !b && existing?.absorptionAmountInitial !== undefined) return true;
  return false;
}

/**
 * 記事URLから取得対象を選ぶ。
 * - 記事番号の年が minYear 未満のものは対象外（base/auto の最古上場年に合わせる）
 * - 既存 enriched に同じ articleUrl があり、その銘柄が上場済みならスキップ（再取得不要）
 * - それ以外（未取得・上場前）は毎回取得する
 */
export function selectTargets(
  urls: string[],
  existing: IpoEnriched[],
  base: IpoBase[],
  auto: IpoAuto[],
  todayIso: string,
  minYear: number,
): TargetSelection {
  const byUrl = new Map(existing.map((e) => [e.articleUrl, e]));
  const targets: string[] = [];
  const skipped: string[] = [];
  for (const url of urls) {
    const num = articleNumberFromUrl(url);
    if (!num || Number(num.slice(0, 4)) < minYear) continue;
    const known = byUrl.get(url);
    if (known && isListedCode(known.code, base, auto, known, todayIso)) {
      skipped.push(url);
    } else {
      targets.push(url);
    }
  }
  return { targets, skipped };
}

/** 既存配列に新規取得分を code 単位で上書き追加する（差分マージ・削除なし）。code 昇順で返す。 */
export function upsertEnriched(
  existing: IpoEnriched[],
  fresh: IpoEnriched[],
): IpoEnriched[] {
  const map = new Map<string, IpoEnriched>();
  for (const e of existing) map.set(e.code, e);
  for (const f of fresh) map.set(f.code, f);
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/** base/auto の最古上場年（取得対象の下限）。データが無ければ今年。 */
export function minListingYear(base: IpoBase[], auto: IpoAuto[], todayIso: string): number {
  const years = [...base.map((b) => b.listingDate), ...auto.map((a) => a.listingDate ?? "")]
    .filter((d) => /^\d{4}-/.test(d))
    .map((d) => Number(d.slice(0, 4)));
  return years.length > 0 ? Math.min(...years) : Number(todayIso.slice(0, 4));
}

/** insufficient 判定の件数（base+auto+enriched をマージした結果で数える）。 */
export function countInsufficient(
  base: IpoBase[],
  auto: IpoAuto[],
  enriched: IpoEnriched[],
): number {
  return mergeIpos(base, auto, enriched).filter(
    (ipo) => assessCompleteness(ipo).level === "insufficient",
  ).length;
}

export interface FetchArticlesOptions {
  fetchText?: FetchText;
  sleep?: (ms: number) => Promise<void>;
  /** 取得日時（ISO）を返す。テストで固定できるよう注入する。 */
  now?: () => string;
  warn?: (message: string) => void;
  log?: (message: string) => void;
}

export interface FetchArticlesResult {
  records: IpoEnriched[];
  failedUrls: string[];
  /** 構造変更（主要ラベル全欠落）を検知した記事URL。 */
  structureChangedUrls: string[];
}

/** 記事URLを順に 1 req/秒で取得・パースする。失敗は warn してスキップし続行する。 */
export async function fetchArticles(
  urls: string[],
  options: FetchArticlesOptions = {},
): Promise<FetchArticlesResult> {
  const fetchText = options.fetchText ?? politeFetchText;
  const wait = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  const warn = options.warn ?? console.warn;
  const log = options.log ?? (() => {});

  const records: IpoEnriched[] = [];
  const failedUrls: string[] = [];
  const structureChangedUrls: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i > 0) await wait(REQUEST_INTERVAL_MS);
    try {
      const { text, url: finalUrl } = await fetchText(url);
      // 存在しない番号は別記事へリダイレクトされるため、最終URLが違えばスキップする。
      if (articleNumberFromUrl(finalUrl) !== articleNumberFromUrl(url)) {
        warn(`[enrich] リダイレクトのためスキップ: ${url} → ${finalUrl}`);
        failedUrls.push(url);
        continue;
      }
      const { record, diagnostics } = parse96utArticleWithDiagnostics(text, url, now());
      if (diagnostics.structureChanged) {
        structureChangedUrls.push(url);
        warn(`[enrich] 構造変更の可能性（主要ラベル欠落）: ${url}`);
      }
      if (!record) {
        warn(`[enrich] 銘柄コードを抽出できないためスキップ: ${url}`);
        failedUrls.push(url);
        continue;
      }
      records.push(record);
      log(`[enrich] ${i + 1}/${urls.length} ${record.code} ${url}`);
    } catch (e) {
      warn(`[enrich] 取得失敗のためスキップ: ${url} (${String(e)})`);
      failedUrls.push(url);
    }
  }
  return { records, failedUrls, structureChangedUrls };
}

export interface EnrichSummary {
  collectedUrls: number;
  targetCount: number;
  skippedCount: number;
  successCount: number;
  failureCount: number;
  failedUrls: string[];
  structureChangeCount: number;
  totalRecords: number;
  insufficientBefore: number;
  insufficientAfter: number;
  insufficientImproved: number;
}

export interface RunEnrichOptions extends FetchArticlesOptions {
  base: IpoBase[];
  auto: IpoAuto[];
  existing: IpoEnriched[];
  todayIso: string;
  /** 記事URLの収集（既定はサイトマップ）。 */
  collectUrls?: () => Promise<string[]>;
}

/** 収集→選別→取得→upsert までを行い、書き込むべき配列とサマリを返す（ファイルI/Oなし）。 */
export async function runEnrich(
  options: RunEnrichOptions,
): Promise<{ enriched: IpoEnriched[]; summary: EnrichSummary }> {
  const { base, auto, existing, todayIso } = options;
  const collect =
    options.collectUrls ??
    (() =>
      collectAllIpoArticleUrls({
        fetchText: options.fetchText,
        sleep: options.sleep,
        warn: options.warn,
      }));
  const urls = await collect();
  const { targets, skipped } = selectTargets(
    urls,
    existing,
    base,
    auto,
    todayIso,
    minListingYear(base, auto, todayIso),
  );
  const result = await fetchArticles(targets, options);
  const enriched = upsertEnriched(existing, result.records);

  const insufficientBefore = countInsufficient(base, auto, existing);
  const insufficientAfter = countInsufficient(base, auto, enriched);
  return {
    enriched,
    summary: {
      collectedUrls: urls.length,
      targetCount: targets.length,
      skippedCount: skipped.length,
      successCount: result.records.length,
      failureCount: result.failedUrls.length,
      failedUrls: result.failedUrls,
      structureChangeCount: result.structureChangedUrls.length,
      totalRecords: enriched.length,
      insufficientBefore,
      insufficientAfter,
      insufficientImproved: Math.max(0, insufficientBefore - insufficientAfter),
    },
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** JST の今日（YYYY-MM-DD）。 */
function jstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const base = await readJson<IpoBase[]>(FILES.base, []);
  const auto = await readJson<IpoAuto[]>(FILES.auto, []);
  const existing = await readJson<IpoEnriched[]>(FILES.enriched, []);
  const todayIso = jstTodayIso();

  console.log(`[enrich] 開始 today=${todayIso} 既存レコード=${existing.length}件`);
  const { enriched, summary } = await runEnrich({
    base,
    auto,
    existing: Array.isArray(existing) ? existing : [],
    todayIso,
    log: (m) => console.log(m),
  });

  // 取得成功が0件なら既存ファイルを触らない（事故で空にしない）。
  if (summary.successCount > 0) {
    await writeFile(FILES.enriched, JSON.stringify(enriched, null, 2) + "\n", "utf-8");
  }

  console.log("=== enrich:data サマリ ===");
  console.log(`収集URL: ${summary.collectedUrls}件`);
  console.log(`対象: ${summary.targetCount}件（取得済み上場銘柄のスキップ: ${summary.skippedCount}件）`);
  console.log(`成功: ${summary.successCount}件 / 失敗: ${summary.failureCount}件`);
  if (summary.failedUrls.length > 0) {
    console.log(`失敗URL:\n  ${summary.failedUrls.join("\n  ")}`);
  }
  console.log(`構造変更検知: ${summary.structureChangeCount}件`);
  console.log(`enriched レコード総数: ${summary.totalRecords}件`);
  console.log(
    `insufficient: ${summary.insufficientBefore}件 → ${summary.insufficientAfter}件（改善 ${summary.insufficientImproved}件）`,
  );
  console.log(
    `ipos.enriched.json 書き込み: ${summary.successCount > 0 ? "あり" : "なし（取得成功0件）"}`,
  );
}

// tsx で直接実行されたときだけ main を走らせる（テストからの import では走らせない）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("enrich:data 実行中に致命的エラー:", err);
    process.exitCode = 1;
  });
}
