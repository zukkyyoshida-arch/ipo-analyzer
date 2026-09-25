// Cloudflare Workers の custom worker（@opennextjs/cloudflare 公式 how-to の方式）。
// 生成済みの .open-next/worker.js の fetch をそのまま使い、Cron 用の scheduled を足す。
// wrangler.jsonc の main をこのファイルに向ける（triggers.crons: ["0 23 * * *"] = JST 8:00）。

// ビルド前は存在せず、ビルド後は存在するため @ts-expect-error では両方を満たせない。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore `.open-next/worker.js` はビルド時に生成される
import { default as handler } from "../.open-next/worker.js";
import { runPushNotifications, type PushWorkerEnv } from "./run-push-notifications";

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
    env: PushWorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    ctx.waitUntil(runPushNotifications(env, { now: new Date(controller.scheduledTime) }));
  },
};

export default worker;

// 生成 worker が export する Durable Object クラス（未使用でも export を保つ）。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore `.open-next/worker.js` はビルド時に生成される
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";
