// Cloudflare Workers の custom worker（@opennextjs/cloudflare 公式 how-to の方式）。
// 生成済みの .open-next/worker.js の fetch をそのまま使い、Cron 用の scheduled を足す。
// wrangler.jsonc の main をこのファイルに向ける。Cron は 2 本で、controller.cron の文字列で分ける:
//   "0 23 * * *"     = JST 8:00 の通知判定（run-push-notifications.ts）
//   "0 0-8 * * 1-5"  = 平日 JST 9:00〜17:00 の毎時、大量保有報告書の日中取得（run-intraday-holdings.ts）

// ビルド前は存在せず、ビルド後は存在するため @ts-expect-error では両方を満たせない。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore `.open-next/worker.js` はビルド時に生成される
import { default as handler } from "../.open-next/worker.js";
import { runPushNotifications, type PushWorkerEnv } from "./run-push-notifications";
// このモジュールの export はハンドラと Durable Object だけにする（それ以外を export すると workerd が起動しない）。
import { INTRADAY_HOLDINGS_CRON, runIntradayHoldings, type IntradayHoldingsEnv } from "./run-intraday-holdings";

/** ScheduledController のうち使う部分（@cloudflare/workers-types に依存しない）。 */
interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

/** ExecutionContext のうち使う部分。 */
interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  fetch: handler.fetch,
  async scheduled(
    controller: ScheduledControllerLike,
    env: PushWorkerEnv & IntradayHoldingsEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    const now = new Date(controller.scheduledTime);
    if (controller.cron === INTRADAY_HOLDINGS_CRON) {
      ctx.waitUntil(runIntradayHoldings(env, { now }));
      return;
    }
    ctx.waitUntil(runPushNotifications(env, { now }));
  },
};

export default worker;

// 生成 worker が export する Durable Object クラス（未使用でも export を保つ）。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore `.open-next/worker.js` はビルド時に生成される
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";
