import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HTTP_TIMEOUT_MS, USER_AGENT } from "./config";
import { parseDelimited } from "./csv";
import { readZipEntries } from "./zip";

// EDINET コードリスト（Edinetcode.zip）で、EDINET コード（発行会社）→ 証券コード（4 桁）を引く。
// 大量保有報告書の書類一覧には発行会社の EDINET コード（issuerEdinetCode）しか無いため、IPO 銘柄との結合に使う。
//
// 2026-09-30 に実物で確かめた形: ZIP の中に EdinetcodeDlInfo.csv が 1 つ。Shift_JIS（Windows-31J）、カンマ区切り、
// 値はダブルクォート（英字名にカンマを含む行がある）、行末 CRLF。1 行目は「ダウンロード実行日,…」、2 行目が見出し
// （ＥＤＩＮＥＴコード,提出者種別,…,証券コード,提出者法人番号）。証券コードは 5 桁（例 "623A0"、末尾 0）。
// API キー不要。更新は週 1 回で足りる（上場会社の追加は月数十件）ので、キャッシュして 7 日ごとに取り直す。

export const EDINET_CODE_LIST_URL =
  "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";

/** キャッシュを取り直す間隔（日）。 */
export const EDINET_CODE_LIST_MAX_AGE_DAYS = 7;

/** キャッシュのファイル名（scripts/updater/.cache/ の下。gitignore 済み）。 */
export const EDINET_CODE_LIST_CACHE_FILE = "Edinetcode.zip";

/** コードリストの CSV（デコード済み）から EDINET コード → 証券コード（4 桁）の対応を作る。 */
export function parseEdinetCodeList(text: string): Map<string, string> {
  const rows = parseDelimited(text, ",");
  const headerIndex = rows.findIndex((r) => r.some((c) => /ＥＤＩＮＥＴコード|EDINETコード/.test(c)));
  if (headerIndex < 0) throw new Error("EDINET コードリストの見出しが見つからない");
  const header = rows[headerIndex];
  const codeCol = header.findIndex((c) => /ＥＤＩＮＥＴコード|EDINETコード/.test(c));
  const secCol = header.findIndex((c) => c.trim() === "証券コード");
  if (codeCol < 0 || secCol < 0) throw new Error("EDINET コードリストの列が見つからない");

  const map = new Map<string, string>();
  for (const r of rows.slice(headerIndex + 1)) {
    const edinetCode = (r[codeCol] ?? "").trim();
    const sec = (r[secCol] ?? "").normalize("NFKC").trim();
    if (!/^E\d{5}$/.test(edinetCode)) continue;
    // 5 桁（末尾 0）→ 4 桁。4 桁で入っていればそのまま
    const code = /^[0-9A-Z]{4}0$/.test(sec) ? sec.slice(0, 4) : /^[0-9A-Z]{4}$/.test(sec) ? sec : "";
    if (code) map.set(edinetCode, code);
  }
  return map;
}

/** Edinetcode.zip（バイト列）を読んで対応表を作る。 */
export function parseEdinetCodeZip(zip: Buffer): Map<string, string> {
  const entry = readZipEntries(zip).find((e) => /\.csv$/i.test(e.name));
  if (!entry) throw new Error("EDINET コードリストの ZIP に CSV が無い");
  return parseEdinetCodeList(new TextDecoder("shift_jis").decode(entry.data));
}

export interface LoadEdinetCodeMapOptions {
  cacheDir: string;
  now?: Date;
  maxAgeDays?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export interface EdinetCodeMapResult {
  map: Map<string, string>;
  /** どこから読んだか */
  from: "cache" | "download" | "staleCache";
  /** ダウンロードした回数（0 か 1） */
  requests: number;
}

async function download(fetchImpl: typeof fetch): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(HTTP_TIMEOUT_MS, 60_000));
  try {
    const res = await fetchImpl(EDINET_CODE_LIST_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 対応表を用意する。キャッシュが maxAgeDays 日以内ならそれを使い、古ければ取り直す。
 * 取り直しに失敗したら古いキャッシュを使う。キャッシュも無ければ例外。
 */
export async function loadEdinetCodeMap(options: LoadEdinetCodeMapOptions): Promise<EdinetCodeMapResult> {
  const {
    cacheDir,
    now = new Date(),
    maxAgeDays = EDINET_CODE_LIST_MAX_AGE_DAYS,
    fetchImpl = fetch,
    log = console.log,
  } = options;
  const cachePath = path.join(cacheDir, EDINET_CODE_LIST_CACHE_FILE);

  let cached: Buffer | null = null;
  let fresh = false;
  try {
    const st = await stat(cachePath);
    cached = await readFile(cachePath);
    fresh = now.getTime() - st.mtimeMs < maxAgeDays * 24 * 3600 * 1000;
  } catch {
    cached = null;
  }

  if (cached && fresh) {
    try {
      return { map: parseEdinetCodeZip(cached), from: "cache", requests: 0 };
    } catch (err) {
      log(`EDINET コードリスト: キャッシュが読めないので取り直す（${(err as Error).message}）`);
    }
  }

  try {
    const zip = await download(fetchImpl);
    const map = parseEdinetCodeZip(zip);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, zip);
    return { map, from: "download", requests: 1 };
  } catch (err) {
    if (cached) {
      log(`EDINET コードリスト: 取得に失敗したので古いキャッシュを使う（${(err as Error).message}）`);
      return { map: parseEdinetCodeZip(cached), from: "staleCache", requests: 1 };
    }
    throw new Error(`EDINET コードリストを取得できない: ${(err as Error).message}`);
  }
}
