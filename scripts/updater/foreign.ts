import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { addDaysIso } from "../../src/lib/date";
import { normalizeDocs } from "../../src/lib/edinet/holdingItem";
import { parseDelimited } from "../../src/lib/edinet/delimited";
import { buildForeignFile, parseForeignFile, sameForeignContent } from "../../src/lib/foreign/file";
import { normalizeCode } from "../../src/lib/margin/file";
import type { ForeignFile, ForeignItem } from "../../src/types/foreign";
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
import { decodeCsvBytes } from "./holdingsCsv";
import { readZipEntries } from "./zip";

// 有価証券報告書の「所有者別状況」から外国法人等の持株比率を取る（public/data/foreign.json）。
// 講師の中長期セカンダリ ④株主構成の「外国人株主の増加」を見るための参考表示。候補は絞らない。
//
// 流れ:
//   1. 走査する日を決める。foreign.json の scannedThrough の翌日（初回は 2023-01-01）から前日（JST）まで。
//      1 回に進む日数は maxDays（既定 120 日、FOREIGN_MAX_DAYS）まで。初回は数晩で追いつき、以後は毎晩 1〜2 日分。
//   2. 日ごとに書類一覧（type=2）を取り、docTypeCode 120（有価証券報告書。訂正 130 は対象外）・取下げでない・CSV あり・
//      提出者（edinetCode）が IPO 銘柄のものだけを選ぶ。書類一覧は CACHE_DIR/edinet-docs/YYYY-MM-DD.json に
//      キャッシュして二度取りしない（使う項目だけに絞って保存）。
//   3. 選んだ書類の CSV（type=5）から、所有者別状況の外国法人等の割合（個人以外＋個人）を取る。
//   4. 銘柄ごとに最新 2 期（当期・前期）を持つ。同じ期の有報が再び出たら提出日の新しい方で上書きする。
//
// XBRL（2026-10-03 に 2025-06-26 提出の有報 CSV で確認。値は 0〜1 の小数＝0.0349 は 3.49%）:
//   jpcrp_cor:PercentageOfShareholdingsForeignersOtherThanIndividuals（所有株式数の割合（％）－外国法人等－個人以外）
//   jpcrp_cor:PercentageOfShareholdingsForeignIndividuals（所有株式数の割合（％）－外国法人等－個人）
//   コンテキスト CurrentYearInstant_OrdinaryShareMember（当期末・普通株式）。合計の要素は無いので 2 つを足す。
//   事業年度末は jpdei_cor:CurrentFiscalYearEndDateDEI（無ければ書類一覧の periodEnd）。
//
// 取得に失敗したら、そこまで取り終えた日までで止める（scannedThrough は途切れなく取り終えた日までしか進めない）。

/** 初回に走査を始める日。 */
export const FOREIGN_START_DATE = "2023-01-01";
/** 1 回の実行で走査する日数の既定値（FOREIGN_MAX_DAYS で変えられる）。 */
export const FOREIGN_MAX_DAYS = 120;
/** 1 回の実行で取る CSV の上限（6 月下旬の繁忙期を 120 日まとめて走査しても収まる数）。 */
export const FOREIGN_MAX_CSV_PER_RUN = 600;
/** 有価証券報告書の docTypeCode（訂正有報 130 は対象外）。 */
export const FOREIGN_DOC_TYPE = "120";
/** 書類一覧のキャッシュ置き場（CACHE_DIR の下）。 */
export const DOC_LIST_CACHE_SUBDIR = "edinet-docs";

/** 外国法人等の割合の要素（名前空間を除く）。 */
export const FOREIGN_ELEMENTS = {
  otherThanIndividuals: "PercentageOfShareholdingsForeignersOtherThanIndividuals",
  individuals: "PercentageOfShareholdingsForeignIndividuals",
} as const;
/** 使うコンテキストの優先順（普通株式の当期末 → 当期末）。どちらも無ければ CurrentYearInstant で始まるもの。 */
const CONTEXT_PRIORITY = ["CurrentYearInstant_OrdinaryShareMember", "CurrentYearInstant"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// CSV の読み取り
// ---------------------------------------------------------------------------

export interface ParsedForeignReport {
  /** 外国法人等（個人以外＋個人）の割合（%）。所有者別状況の要素が無ければ null */
  ratioPercent: number | null;
  /** 使ったコンテキスト（null のときは ""） */
  context: string;
  /** 当事業年度末（YYYY-MM-DD。無ければ ""） */
  fiscalYearEnd: string;
  /** 証券コード（4 桁。無ければ ""） */
  secCode: string;
}

function isBlank(v: string | undefined): boolean {
  if (v === undefined) return true;
  const t = v.trim();
  return t === "" || t === "－" || t === "-" || t === "―" || t === "‐";
}

/** 割合の値（0〜1 の小数。まれに % の数値）→ %。読めなければ null。 */
function toPercent(v: string): number | null {
  const n = Number(v.replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return n * 100;
  if (n <= 100) return n;
  return null;
}

/** 要素ID（名前空間を除く）→ コンテキストID → 値。同じ組の 2 回目以降は無視する。 */
function collect(rows: string[][]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (r.length < 9) continue;
    const id = r[0].replace(/^[^:]*:/, "");
    let byCtx = out.get(id);
    if (!byCtx) {
      byCtx = new Map();
      out.set(id, byCtx);
    }
    if (!byCtx.has(r[2])) byCtx.set(r[2], r[8]);
  }
  return out;
}

function pickContext(values: Map<string, Map<string, string>>): string | null {
  const contexts = new Set<string>();
  for (const id of Object.values(FOREIGN_ELEMENTS)) {
    for (const ctx of values.get(id)?.keys() ?? []) contexts.add(ctx);
  }
  for (const c of CONTEXT_PRIORITY) if (contexts.has(c)) return c;
  return [...contexts].sort().find((c) => c.startsWith("CurrentYearInstant")) ?? null;
}

/** 有報の CSV（デコード済みのタブ区切り）から外国法人等の割合を読む。 */
export function parseForeignCsv(text: string): ParsedForeignReport {
  const values = collect(parseDelimited(text, "\t").slice(1));
  const dei = (id: string): string => {
    const v = values.get(id)?.get("FilingDateInstant");
    return isBlank(v) ? "" : v!.trim();
  };
  const fy = dei("CurrentFiscalYearEndDateDEI");
  const sec = normalizeCode(dei("SecurityCodeDEI").normalize("NFKC")) ?? "";
  const context = pickContext(values);
  let ratioPercent: number | null = null;
  if (context) {
    const raw = Object.values(FOREIGN_ELEMENTS).map((id) => values.get(id)?.get(context));
    // 「－」は 0 株（所有者別状況の空欄）。数値が 1 つも読めない・読めない値があるときは null
    const parts = raw.map((v) => (isBlank(v) ? 0 : toPercent(v!)));
    if (parts.every((p) => p !== null) && raw.some((v) => v !== undefined)) {
      const sum = (parts as number[]).reduce((s, p) => s + p, 0);
      ratioPercent = sum <= 100 ? Math.round(sum * 100) / 100 : null;
    }
  }
  return {
    ratioPercent,
    context: context ?? "",
    fiscalYearEnd: ISO_DATE.test(fy) ? fy : "",
    secCode: sec,
  };
}

/** type=5 の ZIP を読む。有報本体の CSV（jpcrp*-asr）が無ければ例外。 */
export function parseForeignCsvZip(zip: Buffer): ParsedForeignReport {
  const entries = readZipEntries(zip).filter((e) => /\.csv$/i.test(e.name));
  const entry = entries.find((e) => /(^|\/)jpcrp\d{6}-asr/.test(e.name)) ?? entries.find((e) => /(^|\/)jpcrp/.test(e.name));
  if (!entry) throw new Error("ZIP に有報本体の CSV（jpcrp*-asr）が無い");
  return parseForeignCsv(decodeCsvBytes(entry.data));
}

// ---------------------------------------------------------------------------
// 当期・前期の保持
// ---------------------------------------------------------------------------

export interface ForeignPeriod {
  ratioPercent: number;
  fiscalYearEnd: string;
  submitDate: string;
  docId: string;
}

/**
 * 1 期分を足して、最新 2 期（当期・前期）を持つ ForeignItem を返す。
 * 同じ期は提出日の新しい方（同日なら後から来た方）で上書きする。前期より古い期は捨てる。
 */
export function mergeForeignPeriod(current: ForeignItem | undefined, p: ForeignPeriod): ForeignItem {
  const fresh: ForeignItem = {
    ratioPercent: p.ratioPercent,
    fiscalYearEnd: p.fiscalYearEnd,
    submitDate: p.submitDate,
    docId: p.docId,
  };
  if (!current) return fresh;
  const prevOf = (it: ForeignItem) =>
    it.prevRatioPercent !== undefined && it.prevFiscalYearEnd
      ? { prevRatioPercent: it.prevRatioPercent, prevFiscalYearEnd: it.prevFiscalYearEnd }
      : {};
  if (p.fiscalYearEnd === current.fiscalYearEnd) {
    return p.submitDate >= current.submitDate ? { ...fresh, ...prevOf(current) } : current;
  }
  if (p.fiscalYearEnd > current.fiscalYearEnd) {
    return { ...fresh, prevRatioPercent: current.ratioPercent, prevFiscalYearEnd: current.fiscalYearEnd };
  }
  // 当期より古い期: 前期が無いか、前期以降なら前期に入れる
  if (!current.prevFiscalYearEnd || p.fiscalYearEnd >= current.prevFiscalYearEnd) {
    return { ...current, prevRatioPercent: p.ratioPercent, prevFiscalYearEnd: p.fiscalYearEnd };
  }
  return current;
}

// ---------------------------------------------------------------------------
// 走査
// ---------------------------------------------------------------------------

export interface UpdateForeignOptions {
  api: EdinetApi;
  existing: ForeignFile | null;
  /** EDINET コード（提出者）→ 証券コード（4 桁） */
  codeMap: ReadonlyMap<string, string>;
  /** 対象銘柄（4 桁の証券コード） */
  targetCodes: ReadonlySet<string>;
  /** 今日（JST、YYYY-MM-DD）。走査は前日まで */
  today: string;
  /** 走査を始める日（FOREIGN_FROM。省略時は scannedThrough の翌日） */
  from?: string;
  maxDays?: number;
  maxCsvDownloads?: number;
  now?: Date;
  log?: (msg: string) => void;
}

export interface UpdateForeignStats {
  /** 走査した（一覧を取り、選んだ CSV を取り終えた）日数 */
  days: number;
  firstDay: string;
  lastDay: string;
  /** 対象銘柄の有報（docTypeCode 120）の数 */
  matched: number;
  csvDownloads: number;
  /** 比率を入れた（更新した）件数 */
  updated: number;
  csvMissing: number;
  parseErrors: number;
  /** 所有者別状況の要素が無かった件数 */
  noRatio: number;
  /** 取下げで消した数 */
  withdrawn: number;
  /** 打ち切った理由（最後まで取れたら null） */
  stoppedReason: string | null;
}

export interface UpdateForeignResult {
  file: ForeignFile;
  stats: UpdateForeignStats;
}

function errorText(err: unknown): string {
  if (err instanceof EdinetFatalError || err instanceof EdinetRetryExhaustedError) return err.message;
  return `取得エラー: ${(err as Error)?.message ?? String(err)}`;
}

/** 書類一覧の 1 件が、対象銘柄の有報ならその証券コードを返す。 */
function targetCodeOf(
  doc: EdinetDocMeta,
  codeMap: ReadonlyMap<string, string>,
  targets: ReadonlySet<string>,
): string | null {
  const byEdinet = doc.edinetCode ? codeMap.get(doc.edinetCode) : undefined;
  const code = byEdinet ?? (doc.secCode ? normalizeCode(doc.secCode) : null);
  return code && targets.has(code) ? code : null;
}

/**
 * foreign.json を 1 回分進める。api を差し替えればネットワーク無しで試せる。
 * 例外は投げない（取得の失敗は stats.stoppedReason に入れ、取れた分までの file を返す）。
 */
export async function updateForeign(options: UpdateForeignOptions): Promise<UpdateForeignResult> {
  const {
    api,
    codeMap,
    targetCodes,
    today,
    maxDays = FOREIGN_MAX_DAYS,
    maxCsvDownloads = FOREIGN_MAX_CSV_PER_RUN,
    now = new Date(),
    log = console.log,
  } = options;
  const existing = options.existing;
  const stats: UpdateForeignStats = {
    days: 0,
    firstDay: "",
    lastDay: "",
    matched: 0,
    csvDownloads: 0,
    updated: 0,
    csvMissing: 0,
    parseErrors: 0,
    noRatio: 0,
    withdrawn: 0,
    stoppedReason: null,
  };

  const end = addDaysIso(today, -1);
  const floor = addDaysIso(FOREIGN_START_DATE, -1);
  const prevScanned =
    existing?.scannedThrough && existing.scannedThrough >= floor ? existing.scannedThrough : floor;
  const next = addDaysIso(prevScanned, 1);
  const start = options.from && ISO_DATE.test(options.from) ? options.from : next;
  // 途切れずにつながる走査だけが scannedThrough を進める（FOREIGN_FROM で先へ飛んだ分は、項目だけ足す）
  const contiguous = start <= next;

  const items = new Map<string, ForeignItem>(Object.entries(existing?.items ?? {}));
  const byDocId = new Map<string, string>();
  for (const [code, it] of items) byDocId.set(it.docId, code);

  let scannedThrough = prevScanned;
  let completed = "";

  outer: for (let day = start, n = 0; day <= end && n < maxDays; day = addDaysIso(day, 1), n++) {
    let docs: EdinetDocMeta[];
    try {
      docs = normalizeDocs(await api.listDocuments(day));
    } catch (err) {
      stats.stoppedReason = errorText(err);
      break;
    }
    const queue: { doc: EdinetDocMeta; code: string }[] = [];
    for (const doc of docs) {
      if (doc.withdrawalStatus === "2" || doc.withdrawalStatus === "1") {
        const target = doc.withdrawalStatus === "2" ? doc.docID : doc.parentDocID;
        const code = target ? byDocId.get(target) : undefined;
        if (code && items.get(code)?.docId === target) {
          items.delete(code);
          byDocId.delete(target!);
          stats.withdrawn++;
        }
        continue;
      }
      if (doc.docTypeCode !== FOREIGN_DOC_TYPE || doc.withdrawalStatus !== "0" || doc.csvFlag !== "1") continue;
      const code = targetCodeOf(doc, codeMap, targetCodes);
      if (!code) continue;
      queue.push({ doc, code });
    }
    queue.sort((a, b) => (a.doc.submitDateTime ?? "").localeCompare(b.doc.submitDateTime ?? "") || a.doc.docID.localeCompare(b.doc.docID));
    stats.matched += queue.length;

    for (const { doc, code: listedCode } of queue) {
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
      let parsed: ParsedForeignReport;
      try {
        parsed = parseForeignCsvZip(zip);
      } catch (err) {
        stats.parseErrors++;
        log(`外国人比率: ${doc.docID} の CSV を読めない（${(err as Error).message}）`);
        continue;
      }
      // 有報は提出者＝発行会社なので、EDINET コードからの結合を正とする（CSV の証券コードは記載誤りがある。
      // 2025-06-27 のウェルネス・コミュニケーションズ 366A は DEI に 9228 と書かれていた）。食い違いはログだけ
      const code = listedCode;
      if (parsed.secCode && parsed.secCode !== listedCode) {
        log(`外国人比率: ${doc.docID} の証券コードが食い違う（一覧 ${listedCode} / CSV ${parsed.secCode}。一覧を使う）`);
      }
      const fiscalYearEnd = parsed.fiscalYearEnd || (doc.periodEnd && ISO_DATE.test(doc.periodEnd) ? doc.periodEnd : "");
      if (parsed.ratioPercent === null || !fiscalYearEnd) {
        stats.noRatio++;
        log(`外国人比率: ${doc.docID}（${code}）は所有者別状況の外国法人等の割合が読めない`);
        continue;
      }
      const submitDate = (doc.submitDateTime ?? "").slice(0, 10);
      const merged = mergeForeignPeriod(items.get(code), {
        ratioPercent: parsed.ratioPercent,
        fiscalYearEnd,
        submitDate: ISO_DATE.test(submitDate) ? submitDate : day,
        docId: doc.docID,
      });
      items.set(code, merged);
      byDocId.set(merged.docId, code);
      stats.updated++;
    }

    completed = day;
    stats.days++;
    if (!stats.firstDay) stats.firstDay = day;
    stats.lastDay = day;
    if (stats.days % 30 === 0) log(`外国人比率: ${day} まで走査（CSV ${stats.csvDownloads} 件）`);
  }

  if (contiguous && completed && completed > scannedThrough) scannedThrough = completed;

  // 対象銘柄から外れたものは落とす
  const kept: Record<string, ForeignItem> = {};
  for (const [code, it] of items) if (targetCodes.has(code)) kept[code] = it;

  return { file: buildForeignFile(kept, scannedThrough, now), stats };
}

// ---------------------------------------------------------------------------
// 書類一覧のキャッシュ
// ---------------------------------------------------------------------------

/** キャッシュに残す項目（一覧 1 日分は数百 KB〜1 MB あるので、使う項目だけに絞る）。 */
const CACHED_KEYS = [
  "docID",
  "edinetCode",
  "secCode",
  "filerName",
  "docTypeCode",
  "formCode",
  "issuerEdinetCode",
  "parentDocID",
  "submitDateTime",
  "withdrawalStatus",
  "docInfoEditStatus",
  "csvFlag",
  "periodEnd",
] as const satisfies readonly (keyof EdinetDocMeta)[];

function slimDoc(d: EdinetDocMeta): EdinetDocMeta {
  const out: Record<string, unknown> = {};
  for (const k of CACHED_KEYS) {
    const v = d[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as unknown as EdinetDocMeta;
}

/**
 * 書類一覧を CACHE_DIR/edinet-docs/YYYY-MM-DD.json にキャッシュする EdinetApi を返す。
 * キャッシュするのは今日より前の日だけ（当日分はまだ増える）。CSV は素通し。
 */
export function withDocListCache(api: EdinetApi, cacheDir: string, today: string): EdinetApi & { cacheHits: number } {
  const dir = path.join(cacheDir, DOC_LIST_CACHE_SUBDIR);
  let cacheHits = 0;
  return {
    get requestCount() {
      return api.requestCount;
    },
    get cacheHits() {
      return cacheHits;
    },
    async listDocuments(date: string): Promise<EdinetDocMeta[]> {
      const file = path.join(dir, `${date}.json`);
      if (date < today) {
        try {
          const cached = JSON.parse(await readFile(file, "utf-8")) as unknown;
          if (Array.isArray(cached)) {
            cacheHits++;
            return cached as EdinetDocMeta[];
          }
        } catch {
          // 無い・壊れているときは取り直す
        }
      }
      const docs = (await api.listDocuments(date)).map(slimDoc);
      if (date < today) {
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(file, JSON.stringify(docs), "utf-8");
        } catch {
          // キャッシュに書けなくても走査は続ける
        }
      }
      return docs;
    },
    fetchCsvZip: (docId: string) => api.fetchCsvZip(docId),
  };
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

/** foreign.json の文字列。1 銘柄を 1 行にして、差分を読みやすくする。 */
export function stringifyForeignFile(file: ForeignFile): string {
  const entries = Object.entries(file.items);
  const items =
    entries.length === 0
      ? `  "items": {}`
      : `  "items": {\n${entries.map(([code, it]) => `    ${JSON.stringify(code)}: ${JSON.stringify(it)}`).join(",\n")}\n  }`;
  return `{\n  "generatedAt": ${JSON.stringify(file.generatedAt)},\n  "scannedThrough": ${JSON.stringify(file.scannedThrough)},\n${items}\n}\n`;
}

/** 読み込み（無い・壊れているときは null）。 */
export async function readForeignFile(filePath: string): Promise<ForeignFile | null> {
  try {
    return parseForeignFile(JSON.parse(await readFile(filePath, "utf-8")));
  } catch {
    return null;
  }
}

/** 生成時刻以外が変わったときだけ書く。書いたら true。 */
export async function writeForeignFile(filePath: string, next: ForeignFile): Promise<boolean> {
  const current = await readForeignFile(filePath);
  if (sameForeignContent(current, next)) return false;
  await writeFile(filePath, stringifyForeignFile(next), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// 実行（foreign-main.ts から呼ぶ）
// ---------------------------------------------------------------------------

export interface RunForeignOptions {
  targetCodes: ReadonlySet<string>;
  today: string;
  apiKey?: string;
  filePath?: string;
  cacheDir?: string;
  from?: string;
  maxDays?: number;
  log?: (msg: string) => void;
}

export interface RunForeignResult {
  /** skipped＝キーが無い・コードリストが無いので何もしなかった（既存の foreign.json はそのまま） */
  status: "skipped" | "ok" | "partial";
  file: ForeignFile | null;
  written: boolean;
  stats: UpdateForeignStats | null;
  /** EDINET へのリクエスト数（API＋コードリスト） */
  requests: number;
  durationMs: number;
  message: string;
}

/** foreign.json を 1 回分進めて書く。例外は投げない。 */
export async function runForeignUpdate(options: RunForeignOptions): Promise<RunForeignResult> {
  const started = Date.now();
  const {
    targetCodes,
    today,
    apiKey = process.env.EDINET_API_KEY ?? "",
    filePath = FILES.foreign,
    cacheDir = CACHE_DIR,
    log = console.log,
  } = options;
  const existing = await readForeignFile(filePath);
  const done = (partial: Omit<RunForeignResult, "durationMs">): RunForeignResult => ({
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
      message: "スキップ（EDINET_API_KEY 未設定。foreign.json はそのまま）",
    });
  }
  const safe = (s: string) => redactKey(s, apiKey);

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
      message: `スキップ（${safe((err as Error).message)}。foreign.json はそのまま）`,
    });
  }

  const api = withDocListCache(createEdinetClient(apiKey, { log: (m) => log(safe(m)) }), cacheDir, today);
  const result = await updateForeign({
    api,
    existing,
    codeMap,
    targetCodes,
    today,
    from: options.from,
    maxDays: options.maxDays,
    log: (m) => log(safe(m)),
  });
  if (result.stats.stoppedReason) result.stats.stoppedReason = safe(result.stats.stoppedReason);

  let written = false;
  try {
    written = await writeForeignFile(filePath, result.file);
  } catch (err) {
    log(`foreign.json を書けない: ${safe((err as Error).message)}`);
  }
  const s = result.stats;
  const summary =
    `走査 ${s.firstDay || "—"}〜${s.lastDay || "—"}（${s.days} 日・一覧キャッシュ ${api.cacheHits} 日）` +
    `・scannedThrough ${result.file.scannedThrough}・${Object.keys(result.file.items).length} 銘柄` +
    `（対象の有報 ${s.matched}・CSV ${s.csvDownloads}・更新 ${s.updated}・CSV なし ${s.csvMissing}` +
    `・読めない ${s.parseErrors}・比率なし ${s.noRatio}・取下げ ${s.withdrawn}）` +
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
