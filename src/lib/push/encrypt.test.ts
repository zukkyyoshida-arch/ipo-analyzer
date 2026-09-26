import { describe, it, expect } from "vitest";
import { base64UrlToBytes, bytesToBase64Url, concatBytes, utf8 } from "./base64url";
import {
  decryptAes128gcm,
  encryptAes128gcm,
  importEcdhKeyPair,
  MAX_PLAINTEXT_BYTES,
} from "./encrypt";

// RFC 8291 Appendix A の入力値と期待値（https://www.rfc-editor.org/rfc/rfc8291.txt）。
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

describe("encryptAes128gcm", () => {
  it("RFC 8291 Appendix A のテストベクタと一致する（ヘッダ86オクテット＋暗号文）", async () => {
    const asKeyPair = await importEcdhKeyPair(RFC.asPublic, RFC.asPrivate);
    const body = await encryptAes128gcm(
      base64UrlToBytes(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: base64UrlToBytes(RFC.salt), asKeyPair },
    );
    expect(body.length).toBe(86 + base64UrlToBytes(RFC.ciphertext).length);
    expect(bytesToBase64Url(body.slice(0, 86))).toBe(RFC.header);
    expect(bytesToBase64Url(body.slice(86))).toBe(RFC.ciphertext);
  });

  it("RFC 8291 のベクタを受信側の鍵で復号すると元の平文に戻る", async () => {
    const ua = await importEcdhKeyPair(RFC.uaPublic, RFC.uaPrivate);
    const body = concatBytes(base64UrlToBytes(RFC.header), base64UrlToBytes(RFC.ciphertext));
    const plain = await decryptAes128gcm(body, {
      privateKey: ua.privateKey,
      publicKeyRaw: base64UrlToBytes(RFC.uaPublic),
      auth: base64UrlToBytes(RFC.auth),
    });
    expect(new TextDecoder().decode(plain)).toBe("When I grow up, I want to be a watermelon");
  });

  it("乱数の salt・鍵で暗号化→復号の往復が一致する（日本語 JSON）", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const uaRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const payload = JSON.stringify({ title: "明日BB開始：テスト（1234）", url: "/ipo/1234" });
    const body = await encryptAes128gcm(utf8(payload), {
      p256dh: bytesToBase64Url(uaRaw),
      auth: bytesToBase64Url(auth),
    });
    const plain = await decryptAes128gcm(body, { privateKey: ua.privateKey, publicKeyRaw: uaRaw, auth });
    expect(new TextDecoder().decode(plain)).toBe(payload);
    // レコードサイズは 4096 固定
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
  });

  it("上限を超える平文・不正な鍵は例外", async () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    await expect(encryptAes128gcm(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), keys)).rejects.toThrow();
    await expect(encryptAes128gcm(utf8("x"), { p256dh: "AAAA", auth: RFC.auth })).rejects.toThrow();
    await expect(encryptAes128gcm(utf8("x"), { p256dh: RFC.uaPublic, auth: "AAAA" })).rejects.toThrow();
  });
});
