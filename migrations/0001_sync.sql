-- 端末間同期: 同期キーの SHA-256（hex）ごとにウォッチ・BB記録・メモの JSON を 1 行で持つ。
CREATE TABLE IF NOT EXISTS sync_store (
  key_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
