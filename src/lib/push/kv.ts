import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { PushKvStore } from "./subscription";

// API ルートから Cloudflare のバインディングを取り出す（サーバー専用）。
// next dev（Cloudflare コンテキスト無し）や KV 未設定の環境では null を返す。

interface PushBindings {
  PUSH_SUBSCRIPTIONS?: PushKvStore;
  VAPID_PUBLIC_KEY?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
}

async function cloudflareEnv(): Promise<PushBindings | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as PushBindings;
  } catch {
    return null;
  }
}

export async function getPushKv(): Promise<PushKvStore | null> {
  const env = await cloudflareEnv();
  return env?.PUSH_SUBSCRIPTIONS ?? null;
}

/** VAPID 公開鍵（process.env → Cloudflare の vars の順に探す）。未設定なら null。 */
export async function getVapidPublicKey(): Promise<string | null> {
  const fromProcess =
    process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (fromProcess) return fromProcess;
  const env = await cloudflareEnv();
  return env?.VAPID_PUBLIC_KEY || env?.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}
