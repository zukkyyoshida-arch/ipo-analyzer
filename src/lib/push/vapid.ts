import { base64UrlToBytes, bytesToBase64Url, utf8 } from "./base64url";

// VAPID（RFC 8292）の ES256 署名。crypto.subtle のみで実装。
// 鍵の形式は web-push 互換: 公開鍵 = raw 非圧縮点（65バイト）の base64url、秘密鍵 = d（32バイト）の base64url。

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** 連絡先（mailto: または https:）。 */
  subject: string;
}

/** JWT の有効期間（秒）。RFC 8292 の上限 24 時間より短くする。 */
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

/** 公開鍵（raw）と秘密鍵 d から ECDSA 署名鍵を復元する。 */
export async function importVapidPrivateKey(
  publicKey: string,
  privateKey: string,
): Promise<CryptoKey> {
  const raw = base64UrlToBytes(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("invalid VAPID public key");
  if (base64UrlToBytes(privateKey).length !== 32) throw new Error("invalid VAPID private key");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(raw.slice(1, 33)),
      y: bytesToBase64Url(raw.slice(33, 65)),
      d: privateKey,
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * VAPID の JWT（ES256）を作る。crypto.subtle の ECDSA 署名は r||s（64バイト）で JWS と同形式。
 * @param audience プッシュサービスのオリジン（endpoint の origin）
 * @param nowSeconds 現在時刻（UNIX 秒）。純関数にするため呼び出し側が渡す
 */
export async function createVapidJwt(
  audience: string,
  subject: string,
  signingKey: CryptoKey,
  nowSeconds: number,
): Promise<string> {
  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(nowSeconds) + JWT_LIFETIME_SECONDS,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    utf8(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Authorization ヘッダ値（`vapid t=<JWT>, k=<公開鍵>`）を作る。 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds: number,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const key = await importVapidPrivateKey(vapid.publicKey, vapid.privateKey);
  const jwt = await createVapidJwt(audience, vapid.subject, key, nowSeconds);
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

/** VAPID 鍵ペアを新規生成する（.env 作成用。値は画面・ログに残さない運用にする）。 */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("failed to export private key");
  return { publicKey: bytesToBase64Url(raw), privateKey: jwk.d };
}
