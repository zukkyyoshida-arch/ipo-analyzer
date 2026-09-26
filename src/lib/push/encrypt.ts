import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  utf8,
  type Bytes,
} from "./base64url";

// Web Push のペイロード暗号化（RFC 8291 / aes128gcm, RFC 8188）。crypto.subtle のみで実装。
// @pushforge/builder は旧仕様（Content-Encoding: aesgcm）を出力するため採用せず自前実装した。

/** 1レコード（4096オクテット）で送る。 */
export const RECORD_SIZE = 4096;
/** ヘッダ（salt16 + rs4 + idlen1 + keyid65）の長さ。 */
const HEADER_LENGTH = 86;
/** プッシュサービスが受け付ける本文上限（4096）からヘッダ・区切り・タグを引いた平文上限。 */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_LENGTH - 1 - 16;

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

async function hkdf(
  salt: Uint8Array,
  ikm: Bytes,
  info: Bytes,
  length: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as Bytes, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function exportRaw(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

async function ecdhSecret(privateKey: CryptoKey, publicRaw: Bytes): Promise<Bytes> {
  const pub = await crypto.subtle.importKey("raw", publicRaw, P256, false, []);
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

/** 鍵導出（RFC 8291 §3.3-3.4）。CEK と NONCE を返す。 */
async function deriveKeyAndNonce(
  ecdh: Bytes,
  auth: Bytes,
  uaPublic: Bytes,
  asPublic: Bytes,
  salt: Uint8Array,
): Promise<{ cek: CryptoKey; nonce: Bytes }> {
  const keyInfo = concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdh, keyInfo, 32);
  const cekBytes = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const cek = await crypto.subtle.importKey("raw", cekBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return { cek, nonce };
}

/** raw 公開鍵（65バイト）と秘密鍵 d（base64url）から ECDH 鍵ペアを復元する（テストベクタ用）。 */
export async function importEcdhKeyPair(
  publicKeyB64u: string,
  privateKeyB64u: string,
): Promise<CryptoKeyPair> {
  const raw = base64UrlToBytes(publicKeyB64u);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("invalid P-256 public key");
  const x = bytesToBase64Url(raw.slice(1, 33));
  const y = bytesToBase64Url(raw.slice(33, 65));
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d: privateKeyB64u, ext: true },
    P256,
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.importKey("raw", raw, P256, true, []);
  return { privateKey, publicKey };
}

export interface EncryptOptions {
  /** テスト用: 固定 salt（16バイト）。省略時は乱数。 */
  salt?: Uint8Array;
  /** テスト用: 固定のアプリケーションサーバー鍵ペア。省略時は毎回生成。 */
  asKeyPair?: CryptoKeyPair;
}

/**
 * 平文を購読者の公開鍵（p256dh）と auth で暗号化し、aes128gcm 本文（ヘッダ＋暗号文）を返す。
 * @param plaintext 平文（通常は JSON 文字列の UTF-8）
 * @param keys 購読情報の keys（base64url）
 */
export async function encryptAes128gcm(
  plaintext: Uint8Array,
  keys: { p256dh: string; auth: string },
  options: EncryptOptions = {},
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`payload too large (${plaintext.length} > ${MAX_PLAINTEXT_BYTES})`);
  }
  const uaPublic = base64UrlToBytes(keys.p256dh);
  const auth = base64UrlToBytes(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid p256dh");
  if (auth.length !== 16) throw new Error("invalid auth");

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("invalid salt");
  const asKeys =
    options.asKeyPair ??
    ((await crypto.subtle.generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = await exportRaw(asKeys.publicKey);

  const ecdh = await ecdhSecret(asKeys.privateKey, uaPublic);
  const { cek, nonce } = await deriveKeyAndNonce(ecdh, auth, uaPublic, asPublic, salt);

  // 単一レコード = 平文 || 0x02（最終レコードの区切り）。
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cek, padded),
  );

  const header = new Uint8Array(HEADER_LENGTH);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
}

/**
 * aes128gcm 本文を受信側（ユーザーエージェント）の鍵で復号する。テストでの往復検証用。
 */
export async function decryptAes128gcm(
  body: Uint8Array,
  ua: { privateKey: CryptoKey; publicKeyRaw: Uint8Array; auth: Uint8Array },
): Promise<Bytes> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const ecdh = await ecdhSecret(ua.privateKey, asPublic);
  const { cek, nonce } = await deriveKeyAndNonce(
    ecdh,
    ua.auth.slice() as Bytes,
    ua.publicKeyRaw.slice() as Bytes,
    asPublic,
    salt,
  );
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, ciphertext),
  );
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error("padding delimiter not found");
  return padded.slice(0, end);
}
