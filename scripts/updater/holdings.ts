import { readFile, writeFile } from "node:fs/promises";
import type { IpoAuto, IpoBase } from "../../src/types/data";
import { parseHoldingsFile } from "../../src/lib/holdings/file";
import type { HoldingsFile } from "../../src/lib/holdings/types";
import { CACHE_DIR, FILES } from "./config";
import { createEdinetClient, redactKey } from "./edinet";
import { loadEdinetCodeMap } from "./edinetCodes";
import {
  buildHoldingsIssuerMap,
  buildHoldingsUniverse,
  sameHoldingsContent,
  stringifyHoldingsFile,
  updateHoldings,
  type HoldingsIssuersFile,
  type UpdateHoldingsStats,
} from "./holdingsCore";

// 大量保有報告書（public/data/holdings.json）の夜間取得の、ファイルを読み書きする部分と実行。
// 取得・解析の本体（Node に依存しない部分）は holdingsCore.ts。既存の import 先を変えないよう、ここから再エクスポートする。
export * from "./holdingsCore";


/** holdings-issuers.json を書く（対応表が変わったときだけ）。書いたら true。 */
export async function writeHoldingsIssuersFile(
  filePath: string,
  issuers: Record<string, string>,
  now = new Date(),
): Promise<boolean> {
  try {
    const current = JSON.parse(await readFile(filePath, "utf-8")) as Partial<HoldingsIssuersFile>;
    if (JSON.stringify(current.issuers ?? null) === JSON.stringify(issuers)) return false;
  } catch {
    // 無い・壊れている → 書く
  }
  const file: HoldingsIssuersFile = { generatedAt: now.toISOString(), issuers };
  await writeFile(filePath, `${JSON.stringify(file, null, 1)}\n`, "utf-8");
  return true;
}

/** 読み込み（無い・壊れているときは null）。 */
export async function readHoldingsFile(filePath: string): Promise<HoldingsFile | null> {
  try {
    return parseHoldingsFile(JSON.parse(await readFile(filePath, "utf-8")));
  } catch {
    return null;
  }
}

/** 生成時刻以外が変わったときだけ書く。書いたら true。 */
export async function writeHoldingsFile(filePath: string, next: HoldingsFile): Promise<boolean> {
  const current = await readHoldingsFile(filePath);
  if (sameHoldingsContent(current, next)) return false;
  await writeFile(filePath, stringifyHoldingsFile(next), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// 実行（update:data と holdings:data の両方から呼ぶ）
// ---------------------------------------------------------------------------

export interface RunHoldingsOptions {
  base: readonly IpoBase[];
  auto: readonly IpoAuto[];
  today: string;
  apiKey?: string;
  filePath?: string;
  /** holdings-issuers.json の置き場所（既定は public/data） */
  issuersPath?: string;
  cacheDir?: string;
  maxListRequests?: number;
  maxCsvDownloads?: number;
  backfillDays?: number;
  log?: (msg: string) => void;
}

export interface RunHoldingsResult {
  /** skipped＝キーが無い・コードリストが無いので何もしなかった（既存の holdings.json はそのまま） */
  status: "skipped" | "ok" | "partial";
  /** 取得後（skipped のときは既存）の中身。無ければ null */
  file: HoldingsFile | null;
  written: boolean;
  stats: UpdateHoldingsStats | null;
  /** EDINET へのリクエスト数（API＋コードリスト） */
  requests: number;
  durationMs: number;
  message: string;
}

/** holdings.json を 1 晩分進めて書く。例外は投げない。 */
export async function runHoldingsUpdate(options: RunHoldingsOptions): Promise<RunHoldingsResult> {
  const started = Date.now();
  const {
    base,
    auto,
    today,
    apiKey = process.env.EDINET_API_KEY ?? "",
    filePath = FILES.holdings,
    issuersPath = FILES.holdingsIssuers,
    cacheDir = CACHE_DIR,
    log = console.log,
  } = options;
  const existing = await readHoldingsFile(filePath);
  const done = (partial: Omit<RunHoldingsResult, "durationMs">): RunHoldingsResult => ({
    ...partial,
    durationMs: Date.now() - started,
  });

  if (!apiKey) {
    return done({
      status: "skipped",
      file: existing,
      written: false,
      stats: null,
      requests: 0,
      message: "スキップ（EDINET_API_KEY 未設定。holdings.json はそのまま）",
    });
  }

  let codeMap: Map<string, string>;
  let codeListRequests = 0;
  try {
    const loaded = await loadEdinetCodeMap({ cacheDir, log });
    codeMap = loaded.map;
    codeListRequests = loaded.requests;
    log(`EDINET コードリスト: ${loaded.from}（${loaded.map.size} 社）`);
  } catch (err) {
    return done({
      status: "skipped",
      file: existing,
      written: false,
      stats: null,
      requests: 1,
      message: `スキップ（${(err as Error).message}。holdings.json はそのまま）`,
    });
  }

  const universe = buildHoldingsUniverse(base, auto);
  // Worker の日中取得（worker/run-intraday-holdings.ts）用に、IPO 銘柄の分だけの対応表を残す
  try {
    if (await writeHoldingsIssuersFile(issuersPath, buildHoldingsIssuerMap(universe, codeMap))) {
      log("holdings-issuers.json を更新");
    }
  } catch (err) {
    log(`holdings-issuers.json を書けない: ${(err as Error).message}`);
  }

  const api = createEdinetClient(apiKey, { log });
  const result = await updateHoldings({
    api,
    existing,
    universe,
    codeMap,
    today,
    maxListRequests: options.maxListRequests,
    maxCsvDownloads: options.maxCsvDownloads,
    backfillDays: options.backfillDays,
    log,
  });
  const safe = (s: string) => redactKey(s, apiKey);
  if (result.stats.stoppedReason) result.stats.stoppedReason = safe(result.stats.stoppedReason);

  let written = false;
  try {
    written = await writeHoldingsFile(filePath, result.file);
  } catch (err) {
    log(`holdings.json を書けない: ${safe((err as Error).message)}`);
  }
  const s = result.stats;
  const summary =
    `${result.file.coveredFrom || "—"}〜${result.file.coveredThrough || "—"}・${result.file.items.length} 件` +
    `（一覧 ${s.listRequests} 本・CSV ${s.csvDownloads} 件・追加 ${s.added}・訂正 ${s.amended}・取下げ ${s.withdrawn}` +
    `・期限切れ ${s.pruned}・CSV なし ${s.csvMissing}・読めない ${s.parseErrors}）` +
    (s.unknownFormCodes.length > 0 ? `・未知の formCode ${s.unknownFormCodes.join(",")}` : "") +
    (s.stoppedReason ? `・打ち切り: ${s.stoppedReason}` : "");
  return done({
    status: s.stoppedReason ? "partial" : "ok",
    file: result.file,
    written,
    stats: s,
    requests: api.requestCount + codeListRequests,
    message: summary,
  });
}
