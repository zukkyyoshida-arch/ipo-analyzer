import { describe, it, expect } from "vitest";
import { base64UrlToBytes, utf8 } from "./base64url";
import { createVapidJwt, generateVapidKeys, importVapidPrivateKey, vapidAuthorization } from "./vapid";

async function publicVerifyKey(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

describe("VAPID", () => {
  it("生成した鍵は raw 公開鍵65バイト・秘密鍵32バイトの base64url", async () => {
    const keys = await generateVapidKeys();
    expect(base64UrlToBytes(keys.publicKey)).toHaveLength(65);
    expect(base64UrlToBytes(keys.privateKey)).toHaveLength(32);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("JWT は ES256 で公開鍵により検証でき、aud/sub/exp（24時間以内）を持つ", async () => {
    const keys = await generateVapidKeys();
    const signingKey = await importVapidPrivateKey(keys.publicKey, keys.privateKey);
    const now = 1_790_000_000;
    const jwt = await createVapidJwt("https://fcm.googleapis.com", "mailto:test@example.com", signingKey, now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(base64UrlToBytes(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:test@example.com");
    expect(claims.exp).toBeGreaterThan(now);
    expect(claims.exp - now).toBeLessThanOrEqual(24 * 60 * 60);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await publicVerifyKey(keys.publicKey),
      base64UrlToBytes(s),
      utf8(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("Authorization ヘッダは vapid t=<JWT>, k=<公開鍵> で aud は endpoint のオリジン", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization(
      "https://web.push.apple.com/QAbc/def",
      { ...keys, subject: "mailto:test@example.com" },
      1_790_000_000,
    );
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(m![1].split(".")[1])));
    expect(claims.aud).toBe("https://web.push.apple.com");
  });

  it("不正な鍵は例外", async () => {
    await expect(importVapidPrivateKey("AAAA", "AAAA")).rejects.toThrow();
  });
});
