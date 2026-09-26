// base64url（パディングなし）とバイト列の相互変換。Workers・ブラウザ・Node で共通に動く btoa/atob を使う。

export type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url（標準 base64 も許容）をバイト列へ。不正な文字列は例外。 */
export function base64UrlToBytes(value: string): Bytes {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text) as Bytes;
}
