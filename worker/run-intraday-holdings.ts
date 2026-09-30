import type { IpoAuto, IpoBase } from "@/types/data";
import { addDaysIso } from "@/lib/date";
import { HOLDINGS_SOURCE_TEXT, type HoldingsFile } from "@/lib/holdings/types";
import {
  HOLDINGS_INTRADAY_TTL_SECONDS,
  intradayHoldingsKey,
  parseIntradayHoldings,
} from "@/lib/holdings/intraday";
import bundledBase from "../public/data/ipos.base.json";
import bundledAuto from "../public/data/ipos.auto.json";
import bundledIssuers from "../public/data/holdings-issuers.json";
import { createEdinetClient, redactKey, type EdinetApi } from "../scripts/updater/edinet";
import {
  HOLDINGS_BACKFILL_DAYS,
  buildHoldingsUniverse,
  updateHoldings,
  type UpdateHoldingsStats,
} from "../scripts/updater/holdingsCore";

// Cron（平日 9:00〜17:00 JST の毎時 = "0 0-8 * * MON-FRI" UTC。振り分けは cron-jobs.ts）から呼ばれる大量保有報告書の日中取得。
//
// holdings.json は Static Assets なので Worker からは書けない。当日分だけを KV（HOLDINGS_INTRADAY）の
// `intraday:YYYY-MM-DD` に holdings.json と同じ形で置き、ホーム（src/app/page.tsx）が holdings.json に重ねて表示する。
// 夜間ジョブが holdings.json に取り込んだ後は不要なので TTL 48 時間で消える。
//
// 取り方は夜間と同じ updateHoldings（scripts/updater/holdingsCore.ts）を「当日 1 日だけ」で呼ぶ:
//   書類一覧（documents.json type=2）1 本 → IPO 銘柄あての 350/360 のうち、まだ KV に無い docID だけ CSV（type=5）を取る。
// Workers 無料枠の subrequest は 1 呼び出し 50 本。一覧 1 本＋CSV 最大 INTRADAY_MAX_CSV 本（再試行込みでも 50 未満）に抑え、
// 上限に達したらそこで打ち切って KV に書き、次の時間に残りを取る（取得済みの docID は KV の items で分かる）。
// 発行会社の EDINET コード → 証券コードは、夜間ジョブが書く holdings-issuers.json（IPO 銘柄の分だけ）を同梱して使う。

/**
 * 大量保有報告書の日中取得の Cron（wrangler.jsonc の triggers.crons と同じ文字列。cron-jobs.ts の表のキー）。
 * Cloudflare の曜日は 1 = 日曜なので、平日は MON-FRI で書く。
 */
export const INTRADAY_HOLDINGS_CRON = "0 0-8 * * MON-FRI";

/**
 * 1 回に取る CSV の上限。一覧 1 本＋CSV 20 本で、全部が 1 回ずつ再試行になっても (1+20)×2 = 42 本と subrequest 50 本に収まる。
 * IPO 銘柄あての提出はふだん 1 日数件なので、1 時間で取り切れる。
 */
export const INTRADAY_MAX_CSV = 20;
/** 再試行の回数（Worker では少なく。だめなら次の時間に取り直す）。 */
const INTRADAY_MAX_RETRIES = 1;
/** リクエストの間隔（ミリ秒）。夜間と同じく EDINET への連打を避ける（待ち時間は CPU 時間に入らない）。 */
const INTRADAY_REQUEST_INTERVAL_MS = 1_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KVNamespace のうち使う部分。 */
export interface IntradayKvStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** scheduled ハンドラに渡る env のうち使う部分。 */
export interface IntradayHoldingsEnv {
  HOLDINGS_INTRADAY?: IntradayKvStore;
  EDINET_API_KEY?: string;
}

export interface RunIntradayOptions {
  now?: Date;
  /** テスト用: EDINET クライアントの差し替え */
  api?: EdinetApi;
  base?: readonly Pick<IpoBase, "code" | "name" | "listingDate">[];
  auto?: readonly Pick<IpoAuto, "code" | "name" | "listingDate">[];
  /** EDINET コード → 証券コード */
  issuers?: Readonly<Record<string, string>>;
  maxCsvDownloads?: number;
  log?: (message: string) => void;
}

export interface RunIntradaySummary {
  status: "skipped" | "ok" | "partial";
  date: string;
  items: number;
  stats: UpdateHoldingsStats | null;
  requests: number;
  message: string;
}

function jstToday(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 当日分を取り、KV に書く。例外は投げない。 */
export async function runIntradayHoldings(
  env: IntradayHoldingsEnv,
  options: RunIntradayOptions = {},
): Promise<RunIntradaySummary> {
  const now = options.now ?? new Date();
  const log = options.log ?? ((message: string) => console.log(`[holdings] ${message}`));
  const date = jstToday(now);
  const skipped = (message: string): RunIntradaySummary => {
    log(message);
    return { status: "skipped", date, items: 0, stats: null, requests: 0, message };
  };

  const kv = env.HOLDINGS_INTRADAY;
  if (!kv) return skipped("HOLDINGS_INTRADAY が未設定のため中止");
  const apiKey = env.EDINET_API_KEY ?? "";
  if (!apiKey && !options.api) return skipped("EDINET_API_KEY が未設定のため中止");

  const key = intradayHoldingsKey(date);
  const previous = parseIntradayHoldings(await kv.get(key, "text").catch(() => null));
  const yesterday = addDaysIso(date, -1);
  // updateHoldings は「today の前日まで」を取るので、today に翌日を渡し、前回の続き（coveredThrough）を前日にして当日 1 日だけ取らせる
  const existing: HoldingsFile = {
    generatedAt: previous?.generatedAt ?? "",
    coveredFrom: yesterday,
    coveredThrough: yesterday,
    source: HOLDINGS_SOURCE_TEXT,
    items: previous?.items ?? [],
  };
  const issuers = options.issuers ?? (bundledIssuers as { issuers: Record<string, string> }).issuers;
  const api =
    options.api ??
    createEdinetClient(apiKey, {
      intervalMs: INTRADAY_REQUEST_INTERVAL_MS,
      maxRetries: INTRADAY_MAX_RETRIES,
      log,
    });
  const result = await updateHoldings({
    api,
    existing,
    universe: buildHoldingsUniverse(
      options.base ?? (bundledBase as IpoBase[]),
      options.auto ?? (bundledAuto as IpoAuto[]),
    ),
    codeMap: new Map(Object.entries(issuers)),
    today: addDaysIso(date, 1),
    now,
    // 訂正報告書は訂正前の提出日を持つので、古い提出日でも落とさない（夜間と同じ保持期間）
    backfillDays: HOLDINGS_BACKFILL_DAYS,
    recheckDays: 0,
    maxListRequests: 1,
    maxCsvDownloads: options.maxCsvDownloads ?? INTRADAY_MAX_CSV,
    log,
  });
  const stats = result.stats;
  if (stats.stoppedReason) stats.stoppedReason = redactKey(stats.stoppedReason, apiKey);

  // 一覧が取れなかった（listRequests 0）ときは前回の KV をそのまま残す
  if (stats.listRequests === 0) {
    const message = `${date}: 書類一覧を取れず中止（${stats.stoppedReason ?? "理由不明"}）`;
    log(message);
    return { status: "partial", date, items: previous?.items.length ?? 0, stats, requests: api.requestCount, message };
  }

  const file: HoldingsFile = {
    generatedAt: now.toISOString(),
    coveredFrom: date,
    coveredThrough: date,
    source: HOLDINGS_SOURCE_TEXT,
    items: result.file.items,
  };
  await kv.put(key, JSON.stringify(file), { expirationTtl: HOLDINGS_INTRADAY_TTL_SECONDS });
  const message =
    `${date}: ${file.items.length} 件（CSV ${stats.csvDownloads} 件・追加 ${stats.added}・訂正 ${stats.amended}` +
    `・取下げ ${stats.withdrawn}・CSV なし ${stats.csvMissing}・読めない ${stats.parseErrors}）` +
    (stats.stoppedReason ? `・打ち切り: ${stats.stoppedReason}（次の時間に続き）` : "");
  log(message);
  return {
    status: stats.stoppedReason ? "partial" : "ok",
    date,
    items: file.items.length,
    stats,
    requests: api.requestCount,
    message,
  };
}
