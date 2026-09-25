import type { Ipo } from "@/types/ipo";
import type { PushNotificationPayload, PushSubscriberRecord } from "@/types/push";
import { loadIpoData } from "@/lib/repository";
import { upcomingCalendarEvents } from "@/lib/events";
import {
  payloadsForSubscriber,
  priceReleaseWatchCodes,
  selectNotifiableEvents,
} from "@/lib/push/notify";
import { buildPushRequest, sendPushRequest, type FetchLike } from "@/lib/push/send";
import {
  createMemoryKvStore,
  listSubscribers,
  type PushKvStore,
} from "@/lib/push/subscription";

// Cron（毎日 UTC 23:00 = JST 8:00）から呼ばれる通知送信の本体。
// KV 列挙 → 全銘柄読込 → 横断イベント → 通知対象選定 → 購読者ごとに絞り込み → 送信（404/410 は KV から削除）。

/** scheduled ハンドラに渡る env のうち使う部分。 */
export interface PushWorkerEnv {
  PUSH_SUBSCRIPTIONS?: PushKvStore;
  VAPID_PUBLIC_KEY?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
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
}

/** 1.5倍ライン監視中の銘柄を前回分として保存する KV キー（購読キーとは接頭辞で区別）。 */
export const WATCH_STATE_KEY = "state:price-release-watch";
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

async function defaultLoadIpos(): Promise<Ipo[]> {
  const { ipos } = await loadIpoData();
  return ipos;
}

export interface PlannedDelivery {
  key: string;
  record: PushSubscriberRecord;
  payloads: PushNotificationPayload[];
}

export async function runPushNotifications(
  env: PushWorkerEnv,
  options: RunPushOptions = {},
): Promise<RunPushSummary> {
  const log = options.log ?? ((message: string) => console.log(`[push] ${message}`));
  const dryRun = options.dryRun ?? false;
  const todayIso = jstTodayIso(options.now ?? new Date());
  const summary: RunPushSummary = {
    todayIso,
    dryRun,
    subscribers: 0,
    candidates: 0,
    planned: 0,
    sent: 0,
    failed: 0,
    removed: 0,
  };

  const kv = env.PUSH_SUBSCRIPTIONS;
  if (!kv) {
    log("PUSH_SUBSCRIPTIONS が未設定のため中止");
    return summary;
  }

  const ipos = await (options.loadIpos ?? defaultLoadIpos)();
  const events = upcomingCalendarEvents(ipos, todayIso, LOOKAHEAD_DAYS);
  const previousWatchCodes = await readPreviousWatchCodes(kv);
  const candidates = selectNotifiableEvents(events, todayIso, { previousWatchCodes });
  summary.candidates = candidates.length;

  const subscribers = await listSubscribers(kv);
  summary.subscribers = subscribers.length;

  const deliveries: PlannedDelivery[] = subscribers
    .map(({ key, record }) => ({ key, record, payloads: payloadsForSubscriber(candidates, record) }))
    .filter((d) => d.payloads.length > 0);
  summary.planned = deliveries.reduce((sum, d) => sum + d.payloads.length, 0);

  if (dryRun) {
    log(
      `dry-run ${todayIso}: 購読 ${summary.subscribers} / 候補 ${summary.candidates} / 送信予定 ${summary.planned}`,
    );
    return summary;
  }

  // 次回の「新規到達」判定用に、本日の監視中コードを保存する。
  await kv.put(WATCH_STATE_KEY, JSON.stringify(priceReleaseWatchCodes(events, todayIso)));

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
    `${todayIso}: 購読 ${summary.subscribers} / 送信 ${summary.sent} / 失敗 ${summary.failed} / 失効削除 ${summary.removed}`,
  );
  return summary;
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
