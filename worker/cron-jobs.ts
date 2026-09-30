import {
  runInitialPriceWatch,
  runInstantCashCheck,
  runPushNotifications,
  type PushWorkerEnv,
  type RunPushOptions,
} from "./run-push-notifications";
import { runIntradayHoldings } from "./intraday-holdings";

// Cron 文字列 → 処理の対応表（worker/push-scheduled.ts の scheduled から引く）。
// 文字列は wrangler.jsonc の triggers.crons と完全一致させる。Cron を足すときはここに 1 行足す。
// 注意: Cloudflare の曜日は 1 = 日曜（一般的な cron と違う）。平日は数字でなく MON-FRI で書く。

export type CronJob = (env: PushWorkerEnv, options: RunPushOptions) => Promise<unknown>;

export const CRON_JOBS: Readonly<Record<string, CronJob>> = {
  // 毎日 JST 8:00: BB・抽選・購入期限・ロックアップ・1.5倍ライン・仮条件・公開価格・初決算の予告。
  "0 23 * * *": runPushNotifications,
  // 平日 JST 9:00〜15:50 に 10 分ごと: 当日上場銘柄の初値成立。
  "*/10 0-6 * * MON-FRI": runInitialPriceWatch,
  // 平日 JST 15:45（大引け 15:30 の板寄せが反映された後）: 初値が付かなかった銘柄の即金規制の可能性。
  "45 6 * * MON-FRI": runInstantCashCheck,
  // 平日 JST 9:00〜17:00 の毎時: 大量保有報告書の当日分を EDINET から取り込む（worker/intraday-holdings.ts）。
  "0 0-8 * * MON-FRI": (env, options) => runIntradayHoldings(env, { now: options.now, log: options.log }),
};

/** controller.cron に対応する処理。未知の Cron は null（何もしない）。 */
export function jobForCron(cron: string): CronJob | null {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, cron) ? CRON_JOBS[cron] : null;
}
