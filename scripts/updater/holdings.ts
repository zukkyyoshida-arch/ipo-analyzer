import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IpoAuto, IpoBase } from "../../src/types/data";
import { addDaysIso, daysBetween } from "../../src/lib/date";
import { compareHoldingItems, emptyHoldingsFile, parseHoldingsFile } from "../../src/lib/holdings/file";
import {
  HOLDINGS_RETENTION_DAYS,
  HOLDINGS_SOURCE_TEXT,
  type HoldingItem,
  type HoldingsFile,
} from "../../src/lib/holdings/types";
import { CACHE_DIR, FILES } from "./config";
import {
  createEdinetClient,
  EdinetFatalError,
  EdinetRetryExhaustedError,
  redactKey,
  type EdinetApi,
  type EdinetDocMeta,
} from "./edinet";
import { loadEdinetCodeMap } from "./edinetCodes";
import { parseHoldingCsvZip, type ParsedHoldingReport } from "./holdingsCsv";
import {
  buildHoldingItem,
  buildHoldingsUniverse,
  compareForProcessing,
  FORM_TYPES,
  normalizeDocs,
  TARGET_DOC_TYPES,
  type HoldingsUniverseEntry,
} from "../../src/lib/edinet/holdingItem";
import {
  buildHoldingsIssuersFile,
  HOLDINGS_ISSUERS_FILE_NAME,
  parseHoldingsIssuersFile,
  stringifyHoldingsIssuersFile,
  type HoldingsIssuersFile,
} from "../../src/lib/holdings/intraday";

// 書類一覧 → IPO 銘柄の結合と 1 件の組み立ては src/lib/edinet/holdingItem.ts（Worker の日中取得と共用）。
export {
  buildHoldingItem,
  buildHoldingsUniverse,
  inferFormType,
  type HoldingsUniverseEntry,
} from "../../src/lib/edinet/holdingItem";

// 大量保有報告書（public/data/holdings.json）の夜間取得。
//
// 流れ:
//   1. 取る日を決める。前回 coveredThrough の翌日〜前日（JST）。初回・長く止まっていたときは直近 180 日のバックフィル。
//      あわせて直近 7 日は一覧だけ取り直し、取下げ・書類情報の修正を反映する（新しい書類の追加はしない）。
//   2. 日付ごとに書類一覧（type=2）を 1 本ずつ取り、docTypeCode 350/360・取下げでない・CSV あり・
//      発行会社（issuerEdinetCode）が IPO 銘柄（base/auto の全銘柄）のものだけを選ぶ。
//      EDINET コード → 証券コードは EDINET コードリスト（edinetCodes.ts、週 1 で取り直すキャッシュ）で引く。
//   3. 選んだ書類だけ CSV（type=5）を取り、今回/前回割合・保有目的などを取り出す（holdingsCsv.ts）。
//      訂正報告書（360）は訂正前の書類（parentDocID）を置き換える。1 日の中では 350 を先、360 を後に処理する。
//   4. 180 日より前の提出を落とし、提出日の新しい順に並べて書く（生成時刻以外が同じなら書かない）。
// 1 晩の上限（一覧・CSV の本数）に達したり、取得が失敗したりしたら、そこで打ち切る。coveredThrough は
// 最後まで取り終えた日までしか進めないので、次の晩に続きから取る。
//
// あわせて、EDINET コード → IPO 銘柄の写像を public/data/holdings-issuers.json に書く（Worker の日中取得
// worker/intraday-holdings.ts が当日分の結合に使う。Worker は fs もコードリストのキャッシュも使えないため）。
//
// 状態は holdings.json の coveredThrough だけで持つ（別の状態ファイルは作らない）。

/** 初回・長く止まっていたときに遡る日数（＝holdings.json に残す日数）。 */
export const HOLDINGS_BACKFILL_DAYS = HOLDINGS_RETENTION_DAYS;
/** 取下げ・書類情報の修正を拾うために一覧だけ取り直す日数。 */
export const HOLDINGS_RECHECK_DAYS = 7;
/** 1 晩に取る書類一覧の上限（180 日のバックフィル＋取り直しが収まる数）。 */
export const HOLDINGS_MAX_LIST_REQUESTS = 200;
/** 1 晩に取る CSV の上限。IPO 銘柄あての提出は 1 営業日あたり数件なので、ふだんは 10 件前後（設計値）。 */
export const HOLDINGS_MAX_CSV_PER_RUN = 300;
/** record.largeHoldingReport（/events・チェックリスト用）に使う日数。 */
export const LARGE_HOLDING_REPORT_LOOKBACK_DAYS = 7;

export interface UpdateHoldingsOptions {
  api: EdinetApi;
  existing: HoldingsFile | null;
  universe: ReadonlyMap<string, HoldingsUniverseEntry>;
  /** EDINET コード（発行会社）→ 証券コード（4 桁） */
  codeMap: ReadonlyMap<string, string>;
  /** 今日（JST、YYYY-MM-DD）。取るのは前日まで */
  today: string;
  now?: Date;
  backfillDays?: number;
  recheckDays?: number;
  maxListRequests?: number;
  maxCsvDownloads?: number;
  log?: (msg: string) => void;
}

export interface UpdateHoldingsStats {
  /** 取った日（一覧を取れた日）の数 */
  listRequests: number;
  csvDownloads: number;
  added: number;
  /** 訂正報告書で置き換えた数 */
  amended: number;
  /** 取下げで消した数 */
  withdrawn: number;
  /** 180 日より前になって落とした数 */
  pruned: number;
  /** CSV が無かった（404）数 */
  csvMissing: number;
  /** CSV を読めなかった数 */
  parseErrors: number;
  /** 知らない formCode（docTypeCode 350） */
  unknownFormCodes: string[];
  /** 打ち切った理由（最後まで取れたら null） */
  stoppedReason: string | null;
}

export interface UpdateHoldingsResult {
  file: HoldingsFile;
  stats: UpdateHoldingsStats;
}

/** from〜to（両端含む）の日付の列。 */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/**
 * holdings.json を 1 晩分進める。api を差し替えればネットワーク無しで試せる。
 * 例外は投げない（取得の失敗は stats.stoppedReason に入れ、取れた分までの file を返す）。
 */
export async function updateHoldings(options: UpdateHoldingsOptions): Promise<UpdateHoldingsResult> {
  const {
    api,
    universe,
    codeMap,
    today,
    now = new Date(),
    backfillDays = HOLDINGS_BACKFILL_DAYS,
    recheckDays = HOLDINGS_RECHECK_DAYS,
    maxListRequests = HOLDINGS_MAX_LIST_REQUESTS,
    maxCsvDownloads = HOLDINGS_MAX_CSV_PER_RUN,
    log = console.log,
  } = options;
  const existing = options.existing ?? emptyHoldingsFile();
  const stats: UpdateHoldingsStats = {
    listRequests: 0,
    csvDownloads: 0,
    added: 0,
    amended: 0,
    withdrawn: 0,
    pruned: 0,
    csvMissing: 0,
    parseErrors: 0,
    unknownFormCodes: [],
    stoppedReason: null,
  };

  const end = addDaysIso(today, -1);
  const cutoff = addDaysIso(end, -(backfillDays - 1));
  const prevCovered =
    existing.coveredThrough && existing.coveredThrough >= cutoff && existing.coveredThrough <= end
      ? existing.coveredThrough
      : existing.coveredThrough > end
        ? end
        : "";
  const additionStart = prevCovered ? addDaysIso(prevCovered, 1) : cutoff;
  const additionDays = additionStart <= end ? dateRange(additionStart, end) : [];
  // 新しく取る日があるときだけ、直近の取り直しもする（同じ日に何度走らせても余計に叩かない）
  const recheckDays_ =
    prevCovered && additionDays.length > 0
      ? dateRange(
          [addDaysIso(end, -(recheckDays - 1)), cutoff].reduce((a, b) => (a > b ? a : b)),
          prevCovered,
        )
      : [];
  const days = [...recheckDays_, ...additionDays];

  const items = new Map<string, HoldingItem>();
  for (const it of existing.items) items.set(it.docId, { ...it });
  const superseded = new Set<string>();
  for (const it of items.values()) if (it.amendedFrom) superseded.add(it.amendedFrom);

  let coveredThrough = prevCovered;

  outer: for (const day of days) {
    const isAddition = !prevCovered || day > prevCovered;
    if (stats.listRequests >= maxListRequests) {
      stats.stoppedReason = `書類一覧の上限（${maxListRequests} 本）に達した`;
      break;
    }
    let docs: EdinetDocMeta[];
    try {
      docs = normalizeDocs(await api.listDocuments(day));
      stats.listRequests++;
    } catch (err) {
      stats.stoppedReason = errorText(err);
      break;
    }

    const queue: { doc: EdinetDocMeta; entry: HoldingsUniverseEntry }[] = [];
    for (const doc of docs) {
      // 取下げ: 取り下げられた書類（"2"）は docID で、取下書（"1"）は parentDocID で消す
      if (doc.withdrawalStatus === "2" || doc.withdrawalStatus === "1") {
        const target = doc.withdrawalStatus === "2" ? doc.docID : doc.parentDocID;
        if (target && items.delete(target)) stats.withdrawn++;
        continue;
      }
      if (!doc.docTypeCode || !TARGET_DOC_TYPES.has(doc.docTypeCode)) continue;
      if (doc.withdrawalStatus !== "0") continue;
      const code = doc.issuerEdinetCode ? codeMap.get(doc.issuerEdinetCode) : undefined;
      const entry = code ? universe.get(code) : undefined;
      if (!entry) continue;
      if (doc.docTypeCode === "350" && doc.formCode && !FORM_TYPES[doc.formCode]) {
        if (!stats.unknownFormCodes.includes(doc.formCode)) stats.unknownFormCodes.push(doc.formCode);
      }
      const known = items.get(doc.docID);
      if (known) {
        // 書類情報の修正で種類が変わったとき（例: 大量保有報告書 → 変更報告書）は合わせる
        const ft = doc.docTypeCode === "350" && doc.formCode ? FORM_TYPES[doc.formCode] : undefined;
        if (ft && known.formType !== ft) known.formType = ft;
        continue;
      }
      if (!isAddition || superseded.has(doc.docID)) continue;
      if (doc.csvFlag !== "1") continue;
      queue.push({ doc, entry });
    }
    queue.sort((a, b) => compareForProcessing(a.doc, b.doc));

    for (const { doc, entry } of queue) {
      if (stats.csvDownloads >= maxCsvDownloads) {
        stats.stoppedReason = `CSV の上限（${maxCsvDownloads} 件）に達した（${day} の途中）`;
        break outer;
      }
      let zip: Buffer | null;
      try {
        zip = await api.fetchCsvZip(doc.docID);
        stats.csvDownloads++;
      } catch (err) {
        stats.stoppedReason = errorText(err);
        break outer;
      }
      if (zip === null) {
        stats.csvMissing++;
        continue;
      }
      let parsed: ParsedHoldingReport;
      try {
        parsed = parseHoldingCsvZip(zip);
      } catch (err) {
        stats.parseErrors++;
        log(`大量保有: ${doc.docID} の CSV を読めない（${(err as Error).message}）`);
        continue;
      }
      // CSV の発行者コードと結合結果が食い違うときは CSV を正とする（IPO 銘柄でなければ捨てる）
      let target = entry;
      if (parsed.issuerSecCode && parsed.issuerSecCode !== entry.code) {
        const other = universe.get(parsed.issuerSecCode);
        log(`大量保有: ${doc.docID} の発行者コードが食い違う（一覧 ${entry.code} / CSV ${parsed.issuerSecCode}）`);
        if (!other) continue;
        target = other;
      }
      const item = buildHoldingItem(doc, parsed, target, day);
      if (doc.docTypeCode === "360") {
        const parentId = doc.parentDocID || parsed.amendmentOf || "";
        const parent = parentId ? items.get(parentId) : undefined;
        if (parent) {
          item.formType = parent.formType;
          item.submitDate = parent.submitDate;
          items.delete(parentId);
          stats.amended++;
        } else if (parsed.filingDate && parsed.filingDate <= item.submitDate) {
          // 訂正前の書類を持っていない（取得範囲の外など）ときは、表紙の提出日（訂正前の提出日）を使う
          item.submitDate = parsed.filingDate;
        }
        if (parentId) {
          item.amendedFrom = parentId;
          superseded.add(parentId);
        }
      }
      items.set(item.docId, item);
      stats.added++;
    }

    if (isAddition) coveredThrough = day;
    if (stats.listRequests % 30 === 0) {
      log(`大量保有: ${day} まで取得（一覧 ${stats.listRequests} 本・CSV ${stats.csvDownloads} 件）`);
    }
  }

  // 180 日より前の提出を落とし、銘柄名・上場日を最新の base/auto に合わせる
  const kept: HoldingItem[] = [];
  for (const it of items.values()) {
    if (it.submitDate < cutoff) {
      stats.pruned++;
      continue;
    }
    const entry = universe.get(it.code);
    if (entry) {
      it.name = entry.name;
      if (entry.listingDate) it.listingDate = entry.listingDate;
    }
    kept.push(it);
  }
  kept.sort(compareHoldingItems);

  const coveredFrom = coveredThrough
    ? [existing.coveredFrom && prevCovered ? existing.coveredFrom : cutoff, cutoff].reduce((a, b) =>
        a > b ? a : b,
      )
    : "";

  return {
    file: {
      generatedAt: now.toISOString(),
      coveredFrom,
      coveredThrough,
      source: HOLDINGS_SOURCE_TEXT,
      items: kept,
    },
    stats,
  };
}

function errorText(err: unknown): string {
  if (err instanceof EdinetFatalError || err instanceof EdinetRetryExhaustedError) return err.message;
  return `取得エラー: ${(err as Error)?.message ?? String(err)}`;
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------

/** holdings.json の文字列。1 件を 1 行にして、差分を読みやすく・サイズを小さくする。 */
export function stringifyHoldingsFile(file: HoldingsFile): string {
  const head = [
    `  "generatedAt": ${JSON.stringify(file.generatedAt)}`,
    `  "coveredFrom": ${JSON.stringify(file.coveredFrom)}`,
    `  "coveredThrough": ${JSON.stringify(file.coveredThrough)}`,
    `  "source": ${JSON.stringify(file.source)}`,
  ];
  const items =
    file.items.length === 0
      ? `  "items": []`
      : `  "items": [\n${file.items.map((it) => `    ${JSON.stringify(it)}`).join(",\n")}\n  ]`;
  return `{\n${[...head, items].join(",\n")}\n}\n`;
}

/** 生成時刻以外が同じか。 */
export function sameHoldingsContent(a: HoldingsFile | null, b: HoldingsFile): boolean {
  if (!a) return false;
  const strip = (f: HoldingsFile) =>
    JSON.stringify({ coveredFrom: f.coveredFrom, coveredThrough: f.coveredThrough, source: f.source, items: f.items });
  return strip(a) === strip(b);
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

/** 写像ファイルを、生成時刻以外が変わったときだけ書く。書いたら true。 */
export async function writeHoldingsIssuersFile(filePath: string, next: HoldingsIssuersFile): Promise<boolean> {
  let current: HoldingsIssuersFile | null = null;
  try {
    current = parseHoldingsIssuersFile(JSON.parse(await readFile(filePath, "utf-8")));
  } catch {
    current = null;
  }
  if (current && JSON.stringify(current.items) === JSON.stringify(next.items)) return false;
  await writeFile(filePath, stringifyHoldingsIssuersFile(next), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// record.largeHoldingReport（/events・チェックリスト）との橋渡し
// ---------------------------------------------------------------------------

export interface LargeHoldingReport {
  /** 提出日 YYYY-MM-DD */
  date: string;
  /** 提出者名 */
  holder: string;
}

/** 提出日が直近 lookbackDays 日以内の提出から、銘柄ごとに最新 1 件を返す。 */
export function largeHoldingReportsFromHoldings(
  items: readonly HoldingItem[],
  today: string,
  lookbackDays = LARGE_HOLDING_REPORT_LOOKBACK_DAYS,
): Map<string, LargeHoldingReport> {
  const out = new Map<string, LargeHoldingReport>();
  for (const it of [...items].sort(compareHoldingItems)) {
    const elapsed = daysBetween(it.submitDate, today);
    if (elapsed < 0 || elapsed > lookbackDays) continue;
    if (!out.has(it.code)) out.set(it.code, { date: it.submitDate, holder: it.filer });
  }
  return out;
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
  /** 日中取得用の写像の書き出し先（既定は filePath と同じフォルダの holdings-issuers.json） */
  issuersFilePath?: string;
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
  // Worker の日中取得（worker/intraday-holdings.ts）が使う EDINET コード → IPO 銘柄の写像を書く
  try {
    const issuersPath = options.issuersFilePath ?? path.join(path.dirname(filePath), HOLDINGS_ISSUERS_FILE_NAME);
    const issuers = buildHoldingsIssuersFile(universe, codeMap, new Date());
    if (await writeHoldingsIssuersFile(issuersPath, issuers)) {
      log(`${HOLDINGS_ISSUERS_FILE_NAME}: ${issuers.items.length} 社を書き出し`);
    }
  } catch (err) {
    log(`${HOLDINGS_ISSUERS_FILE_NAME} を書けない: ${(err as Error).message}`);
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
