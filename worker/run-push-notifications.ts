import type { Ipo } from "@/types/ipo";
import type { IpoEnriched } from "@/types/enriched";
import type { HistoricalIpo } from "@/types/history";
import type { PushNotificationPayload, PushSubscriberRecord } from "@/types/push";
import { getHistoricalIpos, loadIpoData } from "@/lib/repository";
import { upcomingCalendarEvents } from "@/lib/events";
import {
  buildPayload,
  buildPriceSnapshot,
  detectPriceChanges,
  parsePriceSnapshot,
  payloadsForSubscriber,
  priceReleaseWatchCodes,
  selectNotifiableEvents,
  sortPayloads,
  type PriceSnapshotEntry,
} from "@/lib/push/notify";
import { buildPushRequest, sendPushRequest, type FetchLike } from "@/lib/push/send";
import {
  detectInitialPrice,
  initialPriceWatchTargets,
  instantCashTargets,
  parseInitialPriceState,
  pruneInitialPriceState,
  type DailyBar,
  type InitialPriceState,
} from "@/lib/push/initialPrice";
import {
  buildRecentPool,
  forecastInitialPrice,
  isForecastUsable,
} from "@/lib/secondary/initialForecast";
import {
  createMemoryKvStore,
  listSubscribers,
  type PushKvStore,
} from "@/lib/push/subscription";

// Cron から呼ばれる通知送信の本体。3 つのジョブは「候補の作り方」だけが違い、
// 購読者ごとの絞り込み → 送信（404/410 は KV から削除）は deliverPayloads で共通。
// - runPushNotifications（毎日 JST 8:00）: 横断イベント＋価格スナップショット差分（初決算の予告を含む）
// - runInitialPriceWatch（平日 JST 9:00〜15:50 に 10 分ごと）: 当日上場銘柄の初値成立
// - runInstantCashCheck（平日 JST 15:45）: 当日上場で初値が付かなかった銘柄の即金規制の可能性

/** scheduled ハンドラに渡る env のうち使う部分。 */
export interface PushWorkerEnv {
  PUSH_SUBSCRIPTIONS?: PushKvStore;
  VAPID_PUBLIC_KEY?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** 自分自身（OpenNext の fetch）へのサービスバインディング。/api/quote の呼び出しに使う。 */
  WORKER_SELF_REFERENCE?: { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/** 銘柄コードの日足（古い→新しい順）。取れなければ null。 */
export type QuoteFetcher = (code: string) => Promise<DailyBar[] | null>;

/** 予想初値の計算に使う補助データ。 */
export interface ForecastInputs {
  history: HistoricalIpo[];
  enriched: IpoEnriched[];
}

export interface RunPushOptions {
  /** 実行時刻（既定は現在時刻）。 */
  now?: Date;
  /** true なら送信・KV 書き込みをせず件数だけ返す。 */
  dryRun?: boolean;
  /** 銘柄の読込（テスト用に差し替え可能）。 */
  loadIpos?: () => Promise<Ipo[]>;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  /** 日足の取得（テスト用に差し替え可能。既定は WORKER_SELF_REFERENCE 経由の /api/quote）。 */
  fetchQuote?: QuoteFetcher;
  /** 予想初値の補助データの読込（テスト用に差し替え可能）。 */
  loadForecastInputs?: () => Promise<ForecastInputs>;
}

export interface RunPushSummary {
  todayIso: string;
  dryRun: boolean;
  subscribers: number;
  /** 全体の通知候補（購読者で絞る前）。 */
  candidates: number;
  /** 購読者ごとに絞った後の送信予定件数。 */
  planned: number;
  sent: number;
  failed: number;
  /** 失効（404/410）で KV から削除した購読数。 */
  removed: number;
  /** quote を取得した銘柄数（初値・即金規制のジョブのみ）。 */
  quotes: number;
}

/** 1.5倍ライン監視中の銘柄を前回分として保存する KV キー（購読キーとは接頭辞で区別）。 */
export const WATCH_STATE_KEY = "state:price-release-watch";
/** 全銘柄の仮条件・公開価格の前回スナップショットを保存する KV キー（差分で発表・決定を検知）。 */
export const PRICE_SNAPSHOT_KEY = "state:price-snapshot";
/** 初値の成立と即金規制の送信済みを保存する KV キー（同じ銘柄に 1 回だけ送るため）。 */
export const INITIAL_PRICE_STATE_KEY = "state:initial-price";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 通知に使うイベントの先読み日数（ロックアップ3日以内・明日分が拾えれば足りる）。 */
const LOOKAHEAD_DAYS = 7;

/** JST の今日（YYYY-MM-DD）。 */
export function jstTodayIso(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

async function readPreviousWatchCodes(kv: PushKvStore): Promise<string[] | undefined> {
  const raw = await kv.get(WATCH_STATE_KEY, "text");
  if (raw === null) return undefined;
  try {
    const data: unknown = JSON.parse(raw);
    if (Array.isArray(data)) return data.filter((c): c is string => typeof c === "string");
  } catch {
    // 壊れていれば未保存扱い。
  }
  return undefined;
}

async function readPriceSnapshot(kv: PushKvStore): Promise<PriceSnapshotEntry[] | null> {
  const raw = await kv.get(PRICE_SNAPSHOT_KEY, "text");
  if (raw === null) return null;
  try {
    return parsePriceSnapshot(JSON.parse(raw));
  } catch {
    return null; // 壊れていれば初回扱い（通知しない）。
  }
}

async function readInitialPriceState(kv: PushKvStore, todayIso: string): Promise<InitialPriceState> {
  const raw = await kv.get(INITIAL_PRICE_STATE_KEY, "text");
  let parsed: unknown = null;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 壊れていれば空の状態から。
    }
  }
  return pruneInitialPriceState(parseInitialPriceState(parsed), todayIso);
}

/** /api/quote/[code] を自分自身へのサービスバインディングで呼ぶ（yahoo-finance2 を Cron 側に二重に抱えない）。 */
function defaultQuoteFetcher(env: PushWorkerEnv): QuoteFetcher {
  return async (code) => {
    const self = env.WORKER_SELF_REFERENCE;
    if (!self) return null;
    try {
      const res = await self.fetch(`https://kabu-radar.internal/api/quote/${encodeURIComponent(code)}?days=10`);
      if (!res.ok) return null;
      const data = (await res.json()) as { closes?: unknown };
      if (!Array.isArray(data.closes)) return null;
      return data.closes.filter(
        (b): b is DailyBar =>
          typeof b === "object" && b !== null && typeof (b as DailyBar).date === "string",
      );
    } catch {
      return null;
    }
  };
}

async function defaultLoadForecastInputs(): Promise<ForecastInputs> {
  const [{ enriched }, history] = await Promise.all([loadIpoData(), getHistoricalIpos()]);
  return { history, enriched };
}

async function defaultLoadIpos(): Promise<Ipo[]> {
  const { ipos } = await loadIpoData();
  return ipos;
}

export interface PlannedDelivery {
  key: string;
  record: PushSubscriberRecord;
  payloads: PushNotificationPayload[];
}

function emptySummary(todayIso: string, dryRun: boolean): RunPushSummary {
  return { todayIso, dryRun, subscribers: 0, candidates: 0, planned: 0, sent: 0, failed: 0, removed: 0, quotes: 0 };
}

interface DeliverOptions extends RunPushOptions {
  /** ドライランでないときだけ、送信の前に実行する（状態の保存など）。 */
  beforeSend?: () => Promise<void>;
  /** ログの見出し（ジョブ名）。 */
  label?: string;
}

/** 候補を購読者ごとに絞り込み、送信する（404/410 の購読は KV から削除）。全ジョブ共通。 */
async function deliverPayloads(
  env: PushWorkerEnv,
  kv: PushKvStore,
  candidates: PushNotificationPayload[],
  summary: RunPushSummary,
  options: DeliverOptions,
): Promise<RunPushSummary> {
  const log = options.log ?? ((message: string) => console.log(`[push] ${message}`));
  const label = options.label ? `${options.label} ` : "";
  const { todayIso } = summary;
  summary.candidates = candidates.length;

  const subscribers = await listSubscribers(kv);
  summary.subscribers = subscribers.length;

  const deliveries: PlannedDelivery[] = subscribers
    .map(({ key, record }) => ({ key, record, payloads: payloadsForSubscriber(candidates, record) }))
    .filter((d) => d.payloads.length > 0);
  summary.planned = deliveries.reduce((sum, d) => sum + d.payloads.length, 0);

  if (summary.dryRun) {
    log(
      `${label}dry-run ${todayIso}: 購読 ${summary.subscribers} / 候補 ${summary.candidates} / 送信予定 ${summary.planned}`,
    );
    return summary;
  }

  if (options.beforeSend) await options.beforeSend();

  const publicKey = env.VAPID_PUBLIC_KEY ?? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    log("VAPID 鍵が未設定のため送信しない");
    return summary;
  }
  const vapid = { publicKey, privateKey, subject };
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  for (const delivery of deliveries) {
    for (const payload of delivery.payloads) {
      try {
        const request = await buildPushRequest({
          subscription: delivery.record.subscription,
          payload,
          vapid,
          nowSeconds,
        });
        const result = await sendPushRequest(request, fetchImpl);
        if (result.ok) {
          summary.sent++;
          continue;
        }
        summary.failed++;
        if (result.expired) {
          await kv.delete(delivery.key);
          summary.removed++;
          break; // 失効した購読には残りを送らない
        }
      } catch {
        summary.failed++;
      }
    }
  }

  log(
    `${label}${todayIso}: 購読 ${summary.subscribers} / 送信 ${summary.sent} / 失敗 ${summary.failed} / 失効削除 ${summary.removed}`,
  );
  return summary;
}

export async function runPushNotifications(
  env: PushWorkerEnv,
  options: RunPushOptions = {},
): Promise<RunPushSummary> {
  const log = options.log ?? ((message: string) => console.log(`[push] ${message}`));
  const dryRun = options.dryRun ?? false;
  const todayIso = jstTodayIso(options.now ?? new Date());
  const summary = emptySummary(todayIso, dryRun);

  const kv = env.PUSH_SUBSCRIPTIONS;
  if (!kv) {
    log("PUSH_SUBSCRIPTIONS が未設定のため中止");
    return summary;
  }

  const ipos = await (options.loadIpos ?? defaultLoadIpos)();
  const events = upcomingCalendarEvents(ipos, todayIso, LOOKAHEAD_DAYS);
  const previousWatchCodes = await readPreviousWatchCodes(kv);
  const priceSnapshot = buildPriceSnapshot(ipos);
  const previousSnapshot = await readPriceSnapshot(kv);
  const candidates = sortPayloads([
    ...selectNotifiableEvents(events, todayIso, { previousWatchCodes }),
    ...detectPriceChanges(previousSnapshot, priceSnapshot),
  ]);
  summary.candidates = candidates.length;

  // 次回の「新規到達」判定・仮条件発表／公開価格決定の差分検知用に、本日の状態を保存する（ドライランでは書かない）。
  return deliverPayloads(env, kv, candidates, summary, {
    ...options,
    beforeSend: async () => {
      await kv.put(WATCH_STATE_KEY, JSON.stringify(priceReleaseWatchCodes(events, todayIso)));
      await kv.put(PRICE_SNAPSHOT_KEY, JSON.stringify(priceSnapshot));
    },
  });
}

/** 予想初値の 80% レンジ（予想が使えないときは null）。 */
function forecastRangeFor(ipo: Ipo, ipos: readonly Ipo[], inputs: ForecastInputs | null) {
  if (!inputs || ipo.offeringPrice === null) return null;
  const enriched = inputs.enriched.find((e) => e.code === ipo.code);
  const forecast = forecastInitialPrice(ipo, buildRecentPool(ipos, inputs.history), enriched);
  return isForecastUsable(forecast) ? forecast.range80 : null;
}

/**
 * 初値決定の監視（平日 JST 9:00〜15:50 に 10 分ごと）。
 * 当日上場（初値持ち越し中は数日）の銘柄だけ quote を取り、初値の成立を検知したら 1 回だけ送る。
 * 対象が無ければ quote も購読一覧も読まずに終わる（Workers 無料枠の subrequest・CPU を使わない）。
 */
export async function runInitialPriceWatch(
  env: PushWorkerEnv,
  options: RunPushOptions = {},
): Promise<RunPushSummary> {
  const log = options.log ?? ((message: string) => console.log(`[push] ${message}`));
  const now = options.now ?? new Date();
  const todayIso = jstTodayIso(now);
  const summary = emptySummary(todayIso, options.dryRun ?? false);
  const kv = env.PUSH_SUBSCRIPTIONS;
  if (!kv) {
    log("PUSH_SUBSCRIPTIONS が未設定のため中止");
    return summary;
  }

  const ipos = await (options.loadIpos ?? defaultLoadIpos)();
  const state = await readInitialPriceState(kv, todayIso);
  const targets = initialPriceWatchTargets(ipos, todayIso, state);
  if (targets.length === 0) return summary;

  const fetchQuote = options.fetchQuote ?? defaultQuoteFetcher(env);
  const formed: { ipo: Ipo; price: number }[] = [];
  for (const ipo of targets) {
    summary.quotes++;
    const bars = await fetchQuote(ipo.code);
    const hit = bars ? detectInitialPrice(bars, ipo.listingDate) : null;
    if (!hit) continue;
    formed.push({ ipo, price: hit.price });
    state.formed[ipo.code] = { date: todayIso, price: hit.price };
  }
  if (formed.length === 0) return summary;

  let inputs: ForecastInputs | null = null;
  try {
    inputs = await (options.loadForecastInputs ?? defaultLoadForecastInputs)();
  } catch {
    inputs = null; // 予想が出せなくても初値の通知は送る。
  }
  const candidates = sortPayloads(
    formed.map(({ ipo, price }) =>
      buildPayload("initialPriceFormed", ipo, {
        initialPrice: price,
        forecastRange: forecastRangeFor(ipo, ipos, inputs),
      }),
    ),
  );

  return deliverPayloads(env, kv, candidates, summary, {
    ...options,
    label: "initial-price",
    // 送信より先に成立を記録する（送信の途中で落ちても同じ銘柄を二重に送らない）。
    beforeSend: () => kv.put(INITIAL_PRICE_STATE_KEY, JSON.stringify(state)),
  });
}

/**
 * 即金規制の可能性（平日 JST 15:45）。当日上場でまだ初値が付いていない銘柄を quote で確かめ、
 * 付いていなければ「明日は即金規制の可能性」を 1 回だけ送る。付いていれば成立として記録する
 * （初値決定の通知は runInitialPriceWatch が送る）。
 */
export async function runInstantCashCheck(
  env: PushWorkerEnv,
  options: RunPushOptions = {},
): Promise<RunPushSummary> {
  const log = options.log ?? ((message: string) => console.log(`[push] ${message}`));
  const todayIso = jstTodayIso(options.now ?? new Date());
  const summary = emptySummary(todayIso, options.dryRun ?? false);
  const kv = env.PUSH_SUBSCRIPTIONS;
  if (!kv) {
    log("PUSH_SUBSCRIPTIONS が未設定のため中止");
    return summary;
  }

  const ipos = await (options.loadIpos ?? defaultLoadIpos)();
  const state = await readInitialPriceState(kv, todayIso);
  const targets = instantCashTargets(ipos, todayIso, state);
  if (targets.length === 0) return summary;

  const fetchQuote = options.fetchQuote ?? defaultQuoteFetcher(env);
  const candidates: PushNotificationPayload[] = [];
  let changed = false;
  for (const ipo of targets) {
    summary.quotes++;
    const bars = await fetchQuote(ipo.code);
    // quote が取れないときは判定できないので送らない（誤報を避ける）。
    if (bars === null) continue;
    const hit = detectInitialPrice(bars, ipo.listingDate);
    if (hit) {
      state.formed[ipo.code] = { date: todayIso, price: hit.price };
      changed = true;
      continue;
    }
    state.instantCash[ipo.code] = todayIso;
    changed = true;
    candidates.push(buildPayload("instantCashRegulation", ipo, { date: todayIso }));
  }

  return deliverPayloads(env, kv, sortPayloads(candidates), summary, {
    ...options,
    label: "instant-cash",
    beforeSend: changed ? () => kv.put(INITIAL_PRICE_STATE_KEY, JSON.stringify(state)) : undefined,
  });
}

/** 送信せず件数だけ返す（ドライラン）。 */
export function dryRunPushNotifications(
  env: PushWorkerEnv,
  options: Omit<RunPushOptions, "dryRun"> = {},
): Promise<RunPushSummary> {
  return runPushNotifications(env, { ...options, dryRun: true });
}

// CLI: `npx tsx worker/run-push-notifications.ts --dry-run`
// KV の代わりに空のメモリストアを使い、本日の通知候補件数だけを表示する（送信しない）。
const argv: string[] =
  typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
if (argv[1]?.endsWith("run-push-notifications.ts") && argv.includes("--dry-run")) {
  void dryRunPushNotifications({ PUSH_SUBSCRIPTIONS: createMemoryKvStore() }).then(
    (summary) => console.log(JSON.stringify(summary)),
  );
}
