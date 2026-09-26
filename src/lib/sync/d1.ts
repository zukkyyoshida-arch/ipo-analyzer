import { getCloudflareContext } from "@opennextjs/cloudflare";

// API ルートから同期用 D1（SYNC_DB）を取り出す（サーバー専用）。
// next dev（Cloudflare コンテキスト無し）や D1 未設定の環境では null を返す。
// @cloudflare/workers-types に依存しないよう、使う分だけの最小の型を持つ。

export interface SyncD1Statement {
  bind(...values: unknown[]): SyncD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface SyncD1Database {
  prepare(query: string): SyncD1Statement;
}

interface SyncBindings {
  SYNC_DB?: SyncD1Database;
}

export async function getSyncDb(): Promise<SyncD1Database | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as SyncBindings).SYNC_DB ?? null;
  } catch {
    return null;
  }
}

export interface SyncRow {
  payload: string;
  updated_at: string;
}

/** key_hash の行を読む。無ければ null。 */
export async function readSyncRow(db: SyncD1Database, keyHash: string): Promise<SyncRow | null> {
  return db
    .prepare("SELECT payload, updated_at FROM sync_store WHERE key_hash = ?1")
    .bind(keyHash)
    .first<SyncRow>();
}

/** key_hash の行を保存する（あれば上書き）。 */
export async function writeSyncRow(
  db: SyncD1Database,
  keyHash: string,
  payload: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO sync_store (key_hash, payload, updated_at) VALUES (?1, ?2, ?3) " +
        "ON CONFLICT(key_hash) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(keyHash, payload, updatedAt)
    .run();
}
