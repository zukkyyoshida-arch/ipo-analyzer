import { getCloudflareContext } from "@opennextjs/cloudflare";
import { addDaysIso, jstTodayIso } from "@/lib/date";
import { getHoldingsData } from "@/lib/repository";
import {
  HOLDINGS_INTRADAY_READ_DAYS,
  intradayHoldingsKey,
  mergeIntradayHoldings,
  parseIntradayState,
  type IntradayHoldingsState,
} from "./intraday";
import type { HoldingsFile } from "./types";

// 大量保有報告書の日中取得分（KV）を読み、夜間の holdings.json にマージする（サーバー専用）。
// KV が無い環境（next dev・テスト・バインディング未設定）では何もしない＝holdings.json だけを返す。

/** KVNamespace のうち読むのに使う部分。 */
export interface IntradayKvReader {
  get(key: string, type: "text"): Promise<string | null>;
}

async function intradayKv(): Promise<IntradayKvReader | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as { PUSH_SUBSCRIPTIONS?: IntradayKvReader }).PUSH_SUBSCRIPTIONS ?? null;
  } catch {
    return null;
  }
}

/** 今日を含む直近 days 日分の日中取得分を読む。読めない日は飛ばす。 */
export async function readIntradayHoldingsStates(
  kv: IntradayKvReader | null,
  todayIso: string,
  days = HOLDINGS_INTRADAY_READ_DAYS,
): Promise<IntradayHoldingsState[]> {
  if (!kv) return [];
  const dates = Array.from({ length: days }, (_, i) => addDaysIso(todayIso, -i));
  const states = await Promise.all(
    dates.map(async (date) => {
      try {
        return parseIntradayState(await kv.get(intradayHoldingsKey(date), "text"), date);
      } catch {
        return null;
      }
    }),
  );
  return states.filter((s): s is IntradayHoldingsState => s !== null);
}

/** holdings.json に日中取得分を足したもの（getHoldingsData の代わりにホームで使う）。 */
export async function getHoldingsDataWithIntraday(todayIso = jstTodayIso()): Promise<HoldingsFile | null> {
  const [file, kv] = await Promise.all([getHoldingsData(), intradayKv()]);
  return mergeIntradayHoldings(file, await readIntradayHoldingsStates(kv, todayIso));
}
