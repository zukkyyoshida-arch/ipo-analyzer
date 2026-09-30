import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { HoldingsFile } from "@/lib/holdings/types";
import { intradayHoldingsKey, parseIntradayHoldings } from "@/lib/holdings/intraday";

// 大量保有の日中分（Worker の Cron が KV の HOLDINGS_INTRADAY に置く当日分）をサーバーで読む。
// next dev（Cloudflare コンテキスト無し）・KV 未設定・読めないときは null（holdings.json だけで表示する）。

interface IntradayKv {
  get(key: string, type: "text"): Promise<string | null>;
}

interface HoldingsBindings {
  HOLDINGS_INTRADAY?: IntradayKv;
}

/** その日（JST）の日中分。無ければ null。 */
export async function getIntradayHoldings(todayIso: string): Promise<HoldingsFile | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as unknown as HoldingsBindings).HOLDINGS_INTRADAY;
    if (!kv) return null;
    return parseIntradayHoldings(await kv.get(intradayHoldingsKey(todayIso), "text"));
  } catch {
    return null;
  }
}
