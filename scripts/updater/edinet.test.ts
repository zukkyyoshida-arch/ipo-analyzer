import { describe, expect, it } from "vitest";
import { createEdinetClient, EdinetFatalError, EdinetRetryExhaustedError, redactKey } from "./edinet";

const KEY = "test-key-0123456789";

type Reply = Response | Error;

/** 用意した応答を順に返す fetch と、呼ばれた URL・待ち時間の記録。 */
function setup(replies: Reply[]) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const r = replies.shift();
    if (!r) throw new Error("応答が足りない");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const client = createEdinetClient(KEY, {
    intervalMs: 0,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (m) => logs.push(m),
  });
  return { client, urls, sleeps, logs };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

describe("listDocuments", () => {
  it("type=2 と日付・キーをクエリで渡し、results を返す", async () => {
    const { client, urls } = setup([
      json({ metadata: { status: "200" }, results: [{ docID: "S100AAAA", docTypeCode: "350" }] }),
    ]);
    const docs = await client.listDocuments("2026-09-29");
    expect(docs).toEqual([{ docID: "S100AAAA", docTypeCode: "350" }]);
    expect(urls[0]).toContain("/api/v2/documents.json?date=2026-09-29&type=2&Subscription-Key=");
    expect(client.requestCount).toBe(1);
  });

  it("429・5xx は指数バックオフで再試行する（Retry-After があればそれに従う）", async () => {
    const { client, sleeps } = setup([
      new Response("busy", { status: 429, headers: { "retry-after": "7" } }),
      new Response("err", { status: 503 }),
      json({ metadata: { status: "200" }, results: [] }),
    ]);
    await expect(client.listDocuments("2026-09-29")).resolves.toEqual([]);
    expect(sleeps).toEqual([7000, 10000]);
    expect(client.requestCount).toBe(3);
  });

  it("再試行しても失敗したら EdinetRetryExhaustedError（キーは文言に出さない）", async () => {
    const netErr = new Error(`connect failed https://api.edinet-fsa.go.jp/api/v2/documents.json?Subscription-Key=${KEY}`);
    const { client, logs } = setup([netErr, netErr, netErr, netErr, netErr]);
    const err = await client.listDocuments("2026-09-29").catch((e) => e);
    expect(err).toBeInstanceOf(EdinetRetryExhaustedError);
    expect(String(err.message)).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
    expect(client.requestCount).toBe(5);
  });

  it("401（HTTP でも本文でも）は再試行せず EdinetFatalError", async () => {
    const a = setup([new Response("denied", { status: 401 })]);
    await expect(a.client.listDocuments("2026-09-29")).rejects.toBeInstanceOf(EdinetFatalError);
    expect(a.client.requestCount).toBe(1);
    const b = setup([json({ statusCode: 401, message: "Access denied" })]);
    await expect(b.client.listDocuments("2026-09-29")).rejects.toBeInstanceOf(EdinetFatalError);
    const c = setup([json({ metadata: { status: "401", message: "Unauthorized" } })]);
    await expect(c.client.listDocuments("2026-09-29")).rejects.toBeInstanceOf(EdinetFatalError);
  });

  it("日付の形式が違えば投げる前に止める", async () => {
    const { client } = setup([]);
    await expect(client.listDocuments("2026/09/29")).rejects.toThrow();
    expect(client.requestCount).toBe(0);
  });
});

describe("fetchCsvZip", () => {
  it("ZIP はそのまま返す", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const { client, urls } = setup([
      new Response(new Uint8Array(zip), { status: 200, headers: { "content-type": "application/octet-stream" } }),
    ]);
    const got = await client.fetchCsvZip("S100Z4U9");
    expect(got?.equals(zip)).toBe(true);
    expect(urls[0]).toContain("/api/v2/documents/S100Z4U9?type=5&Subscription-Key=");
  });

  it("書類が無い（HTTP 404・本文の status 404）は null", async () => {
    const a = setup([new Response("", { status: 404 })]);
    await expect(a.client.fetchCsvZip("S100Z4U9")).resolves.toBeNull();
    const b = setup([json({ metadata: { status: "404", message: "Not Found" } })]);
    await expect(b.client.fetchCsvZip("S100Z4U9")).resolves.toBeNull();
  });

  it("ZIP でない想定外の応答は例外", async () => {
    const { client } = setup([json({ metadata: { status: "400" } })]);
    await expect(client.fetchCsvZip("S100Z4U9")).rejects.toBeInstanceOf(EdinetRetryExhaustedError);
  });
});

describe("redactKey", () => {
  it("URL のキーとキーの文字列そのものを伏せる", () => {
    expect(redactKey(`x?Subscription-Key=${KEY}&type=5`, KEY)).toBe("x?Subscription-Key=***&type=5");
    expect(redactKey(`key is ${KEY}`, KEY)).toBe("key is ***");
  });
});
