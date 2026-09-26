// 同期キーの生成・検証・表示・ハッシュ。キーは端末で生成し、サーバーには SHA-256 だけを渡して保存する。

/** base32 風の英数字（見間違えやすい 0/O/1/I を除いた 32 文字）。 */
export const SYNC_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SYNC_KEY_LENGTH = 32;

const SYNC_KEY_PATTERN = /^[A-HJ-NP-Z2-9]{32}$/;

/**
 * 32 文字のランダムな同期キー（160 ビット）。256 は 32 の倍数なので下位 5 ビットで偏りなく選べる。
 * @param fillRandom テスト用に差し替える乱数源（既定は crypto.getRandomValues）
 */
export function generateSyncKey(
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fillRandom(new Uint8Array(SYNC_KEY_LENGTH));
  let key = "";
  for (const byte of bytes) key += SYNC_KEY_ALPHABET[byte & 31];
  return key;
}

/** 入力されたキーを正規化する（空白・ハイフン除去、大文字化）。形式が不正なら null。 */
export function normalizeSyncKey(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const key = input.replace(/[\s-]/g, "").toUpperCase();
  return SYNC_KEY_PATTERN.test(key) ? key : null;
}

/** 表示用に 4 文字ごとにハイフンで区切る。 */
export function formatSyncKey(key: string): string {
  return key.match(/.{1,4}/g)?.join("-") ?? key;
}

/** 伏せ字表示（末尾 4 文字だけ見せる）。 */
export function maskSyncKey(key: string): string {
  const visible = key.slice(-4);
  return formatSyncKey("•".repeat(Math.max(0, key.length - visible.length)) + visible);
}

/** SHA-256(key) の 16 進文字列。 */
export async function hashSyncKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
