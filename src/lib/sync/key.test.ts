import { describe, expect, it } from "vitest";
import {
  SYNC_KEY_ALPHABET,
  formatSyncKey,
  generateSyncKey,
  hashSyncKey,
  maskSyncKey,
  normalizeSyncKey,
} from "./key";

describe("同期キー", () => {
  it("32 文字・許可された文字だけで生成する", () => {
    const key = generateSyncKey();
    expect(key).toHaveLength(32);
    expect([...key].every((c) => SYNC_KEY_ALPHABET.includes(c))).toBe(true);
    expect(generateSyncKey()).not.toBe(key);
  });

  it("乱数の下位 5 ビットで文字を選ぶ", () => {
    const key = generateSyncKey((bytes) => bytes.map((_, i) => i + 32));
    expect(key).toBe(SYNC_KEY_ALPHABET);
  });

  it("入力の正規化（空白・ハイフン・小文字を許容、不正は null）", () => {
    const key = generateSyncKey();
    expect(normalizeSyncKey(` ${formatSyncKey(key).toLowerCase()} `)).toBe(key);
    expect(normalizeSyncKey("ABC")).toBeNull();
    expect(normalizeSyncKey("O".repeat(32))).toBeNull();
    expect(normalizeSyncKey(null)).toBeNull();
  });

  it("表示用の区切りと伏せ字", () => {
    const key = SYNC_KEY_ALPHABET;
    expect(formatSyncKey(key)).toBe("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789");
    expect(maskSyncKey(key)).toBe("••••-••••-••••-••••-••••-••••-••••-6789");
  });

  it("SHA-256 を 16 進で返す", async () => {
    expect(await hashSyncKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
