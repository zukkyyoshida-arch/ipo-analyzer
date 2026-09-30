import { jstTodayIso } from "@/lib/date";
import {
  createEdinetClient,
  EdinetFatalError,
  EdinetRetryExhaustedError,
  redactKey,
  REQUEST_INTERVAL_MS,
  type EdinetApi,
  type EdinetDocMeta,
} from "@/lib/edinet/client";
import {
  buildHoldingItem,
  compareForProcessing,
  normalizeDocs,
  TARGET_DOC_TYPES,
  type HoldingsUniverseEntry,
} from "@/lib/edinet/holdingItem";
import { parseHoldingCsvZip, type ParsedHoldingReport } from "@/lib/edinet/holdingsCsv";
import {
  emptyIntradayState,
  HOLDINGS_INTRADAY_TTL_SECONDS,
  HOLDINGS_ISSUERS_FILE_NAME,
  intradayHoldingsKey,
  parseHoldingsIssuersFile,
  parseIntradayState,
  type HoldingsIssuersFile,
  type IntradayHoldingsState,
} from "@/lib/holdings/intraday";
import type { HoldingItem } from "@/lib/holdings/types";

// 大量保有報告書の「日中取得」。Cloudflare Cron（平日 JST 9:00〜17:00 の毎時）から呼ばれ、
// EDINET API v2 の当日の書類一覧を 1 本取り、IPO 銘柄あての 350/360 のうち未処理のものだけ CSV を取り、
// KV（PUSH_SUBSCRIPTIONS）の `holdings:intraday:YYYY-MM-DD` に積む。表示側は src/lib/holdings/intradayStore.ts。
// 夜間ジョブ（scripts/updater/holdings.ts）が翌日以降に同じ日を取り直すので、ここは「早く見せる」ための仮置き。
//
// 無料枠に収める:
// - subrequest（無料 50 本/呼び出し）: 写像の読み込み 1＋書類一覧 1＋CSV は最大 INTRADAY_MAX_CSV_PER_RUN 本。
//   再試行も数えて INTRADAY_SUBREQUEST_BUDGET を超えそうなら、その時点で残りを次の時間に回す。
// - KV: 読み 1・書き 1／回（平日 9 回/日）。
// - CPU（無料 10ms/呼び出し）はネットワーク待ちを含まない。CSV は 1 件数 KB で、1 時間に数件が普通。

/**
 * 平日 JST 9:00〜17:00 の毎時（UTC 0〜8 時）。worker/cron-jobs.ts の表・wrangler.jsonc の triggers.crons と同じ文字列。
 * Cloudflare の曜日は 1＝日曜なので、数字（1-5＝日〜木）ではなく MON-FRI で書く。
 */
export const INTRADAY_HOLDINGS_CRON = "0 0-8 * * MON-FRI";
/** 1 回に取る CSV の上限。超えた分は次の時間に回す。 */
export const INTRADAY_MAX_CSV_PER_RUN = 20;
/** 1 回の subrequest の予算（無料枠 50 から余裕を 5 本残す）。 */
export const INTRADAY_SUBREQUEST_BUDGET = 45;
/** 再試行の回数（夜間は 4 回。日中は次の時間があるので 1 回だけ）。 */
export const INTRADAY_MAX_RETRIES = 1;
/** 再試行までの待ち（ミリ秒）。 */
export const INTRADAY_BACKOFF_MS = 5_000;
/**
 * リクエストの間隔（ミリ秒）。夜間と同じ REQUEST_INTERVAL_MS（1.5 秒）を守る。
 * 22 本でも待ちは約 30 秒で、Cron の実行時間の上限（15 分）に十分収まり、待ちは CPU 時間に数えられない。
 */
export const INTRADAY_REQUEST_INTERVAL_MS = REQUEST_INTERVAL_MS;
/** 写像ファイルを Static Assets から読むときの URL（ASSETS バインディングはホスト名を見ない）。 */
const ISSUERS_ASSET_URL = `https://assets.local/data/${HOLDINGS_ISSUERS_FILE_NAME}`;

/** KVNamespace のうち使う部分（put の TTL つき）。 */
export interface IntradayKvStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Static Assets バインディングのうち使う部分。 */
export interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>;
}

/** scheduled ハンドラに渡る env のうち使う部分。 */
export interface IntradayHoldingsEnv {
  PUSH_SUBSCRIPTIONS?: IntradayKvStore;
  /** `npx wrangler secret put EDINET_API_KEY` で入れる。未設定なら何もしない */
  EDINET_API_KEY?: string;
  ASSETS?: AssetsFetcher;
}

export interface RunIntradayHoldingsOptions {
  now?: Date;
  /** EDINET クライアント（テスト用に差し替え可能） */
  api?: EdinetApi;
  /** 写像の読み込み（テスト用に差し替え可能。既定は env.ASSETS から読む） */
  loadIssuers?: () => Promise<HoldingsIssuersFile | null>;
  maxCsvPerRun?: number;
  subrequestBudget?: number;
  log?: (message: string) => void;
}

export interface RunIntradayHoldingsSummary {
  status: "skipped" | "ok" | "partial";
  date: string;
  /** 書類一覧の件数（修正前の行を除く） */
  listed: number;
  csvDownloads: number;
  added: number;
  withdrawn: number;
  /** 上限で次の時間に回した件数 */
  deferred: number;
  /** 使った subrequest（写像の読み込み＋EDINET） */
  subrequests: number;
  message: string;
}

async function loadIssuersFromAssets(assets: AssetsFetcher | undefined): Promise<HoldingsIssuersFile | null> {
  if (!assets) return null;
  const res = await assets.fetch(ISSUERS_ASSET_URL);
  if (!res.ok) return null;
  return parseHoldingsIssuersFile(await res.json());
}

function errorText(err: unknown, apiKey: string): string {
  if (err instanceof EdinetFatalError || err instanceof EdinetRetryExhaustedError) return redactKey(err.message, apiKey);
  return redactKey(`取得エラー: ${(err as Error)?.message ?? String(err)}`, apiKey);
}

/** 当日分を 1 回取り込む。例外は投げない（失敗は summary.message に入れ、取れた分までは保存する）。 */
export async function runIntradayHoldings(
  env: IntradayHoldingsEnv,
  options: RunIntradayHoldingsOptions = {},
): Promise<RunIntradayHoldingsSummary> {
  const log = options.log ?? ((message: string) => console.log(`[holdings-intraday] ${message}`));
  const now = options.now ?? new Date();
  const date = jstTodayIso(now);
  const maxCsv = options.maxCsvPerRun ?? INTRADAY_MAX_CSV_PER_RUN;
  const budget = options.subrequestBudget ?? INTRADAY_SUBREQUEST_BUDGET;
  const summary: RunIntradayHoldingsSummary = {
    status: "skipped",
    date,
    listed: 0,
    csvDownloads: 0,
    added: 0,
    withdrawn: 0,
    deferred: 0,
    subrequests: 0,
    message: "",
  };
  const finish = (message: string, status = summary.status): RunIntradayHoldingsSummary => {
    summary.status = status;
    summary.message = message;
    log(`${date}: ${message}`);
    return summary;
  };

  const apiKey = env.EDINET_API_KEY ?? "";
  if (!apiKey) return finish("EDINET_API_KEY が未設定のためスキップ");
  const kv = env.PUSH_SUBSCRIPTIONS;
  if (!kv) return finish("PUSH_SUBSCRIPTIONS が未設定のためスキップ");

  let issuers: HoldingsIssuersFile | null;
  try {
    if (options.loadIssuers) {
      issuers = await options.loadIssuers();
    } else {
      summary.subrequests++;
      issuers = await loadIssuersFromAssets(env.ASSETS);
    }
  } catch (err) {
    return finish(`${HOLDINGS_ISSUERS_FILE_NAME} を読めないためスキップ（${errorText(err, apiKey)}）`);
  }
  if (!issuers || issuers.items.length === 0) {
    return finish(`${HOLDINGS_ISSUERS_FILE_NAME} が無いためスキップ（夜間のデータ更新で作られる）`);
  }
  const byEdinet = new Map<string, HoldingsUniverseEntry>();
  const byCode = new Map<string, HoldingsUniverseEntry>();
  for (const it of issuers.items) {
    const entry = { code: it.code, name: it.name, listingDate: it.listingDate };
    byEdinet.set(it.edinetCode, entry);
    byCode.set(it.code, entry);
  }

  const key = intradayHoldingsKey(date);
  const state: IntradayHoldingsState = parseIntradayState(await kv.get(key, "text"), date) ?? emptyIntradayState(date);
  const items = new Map<string, HoldingItem>(state.items.map((it) => [it.docId, it]));
  const processed = new Set(state.processedDocIds);
  const withdrawn = new Set(state.withdrawnDocIds);
  const superseded = new Set<string>();
  for (const it of items.values()) if (it.amendedFrom) superseded.add(it.amendedFrom);

  const api =
    options.api ??
    createEdinetClient(apiKey, {
      intervalMs: INTRADAY_REQUEST_INTERVAL_MS,
      maxRetries: INTRADAY_MAX_RETRIES,
      backoffBaseMs: INTRADAY_BACKOFF_MS,
      timeoutMs: 30_000,
      log,
    });
  const baseRequests = summary.subrequests;
  const used = () => baseRequests + api.requestCount;
  /** 1 本投げると再試行込みで最大これだけ使う。 */
  const perRequest = 1 + INTRADAY_MAX_RETRIES;

  const save = async () => {
    state.fetchedAt = now.toISOString();
    state.items = [...items.values()];
    state.processedDocIds = [...processed];
    state.withdrawnDocIds = [...withdrawn];
    state.deferred = summary.deferred;
    await kv.put(key, JSON.stringify(state), { expirationTtl: HOLDINGS_INTRADAY_TTL_SECONDS });
  };

  let docs: EdinetDocMeta[];
  try {
    docs = normalizeDocs(await api.listDocuments(date));
  } catch (err) {
    summary.subrequests = used();
    return finish(`書類一覧を取れない（${errorText(err, apiKey)}）`, "partial");
  }
  summary.listed = docs.length;

  const queue: { doc: EdinetDocMeta; entry: HoldingsUniverseEntry }[] = [];
  for (const doc of docs) {
    if (doc.withdrawalStatus === "2" || doc.withdrawalStatus === "1") {
      const target = doc.withdrawalStatus === "2" ? doc.docID : doc.parentDocID;
      if (target && !withdrawn.has(target)) {
        withdrawn.add(target);
        items.delete(target);
        summary.withdrawn++;
      }
      continue;
    }
    if (!doc.docTypeCode || !TARGET_DOC_TYPES.has(doc.docTypeCode)) continue;
    if (doc.withdrawalStatus !== "0" || doc.csvFlag !== "1") continue;
    if (processed.has(doc.docID) || items.has(doc.docID) || superseded.has(doc.docID)) continue;
    const entry = doc.issuerEdinetCode ? byEdinet.get(doc.issuerEdinetCode) : undefined;
    if (!entry) continue;
    queue.push({ doc, entry });
  }
  queue.sort((a, b) => compareForProcessing(a.doc, b.doc));

  let stopped = "";
  for (let i = 0; i < queue.length; i++) {
    const { doc, entry } = queue[i];
    if (summary.csvDownloads >= maxCsv || used() + perRequest > budget) {
      summary.deferred = queue.length - i;
      break;
    }
    let zip: Buffer | null;
    try {
      zip = await api.fetchCsvZip(doc.docID);
      summary.csvDownloads++;
    } catch (err) {
      stopped = errorText(err, apiKey);
      summary.deferred = queue.length - i;
      break;
    }
    processed.add(doc.docID);
    if (zip === null) continue;
    let parsed: ParsedHoldingReport;
    try {
      parsed = parseHoldingCsvZip(zip);
    } catch (err) {
      log(`${doc.docID} の CSV を読めない（${(err as Error).message}）`);
      continue;
    }
    // CSV の発行者コードと結合結果が食い違うときは CSV を正とする（IPO 銘柄でなければ捨てる）
    let target = entry;
    if (parsed.issuerSecCode && parsed.issuerSecCode !== entry.code) {
      const other = byCode.get(parsed.issuerSecCode);
      if (!other) continue;
      target = other;
    }
    const item = buildHoldingItem(doc, parsed, target, date);
    if (doc.docTypeCode === "360") {
      // 訂正前が同じ日の日中分にあれば置き換える。holdings.json 側の訂正前は表示時のマージで置き換える
      const parentId = doc.parentDocID || parsed.amendmentOf || "";
      const parent = parentId ? items.get(parentId) : undefined;
      if (parent) {
        item.formType = parent.formType;
        item.submitDate = parent.submitDate;
        items.delete(parentId);
      } else if (parsed.filingDate && parsed.filingDate <= item.submitDate) {
        item.submitDate = parsed.filingDate;
      }
      if (parentId) {
        item.amendedFrom = parentId;
        superseded.add(parentId);
      }
    }
    items.set(item.docId, item);
    summary.added++;
  }
  summary.subrequests = used();

  try {
    await save();
  } catch (err) {
    return finish(`KV に書けない（${errorText(err, apiKey)}）`, "partial");
  }
  const counts =
    `一覧 ${summary.listed} 件・CSV ${summary.csvDownloads} 件・追加 ${summary.added}・取下げ ${summary.withdrawn}` +
    `・持ち越し ${summary.deferred}・subrequest ${summary.subrequests}`;
  if (stopped) return finish(`${counts}・打ち切り: ${stopped}`, "partial");
  return finish(counts, "ok");
}
