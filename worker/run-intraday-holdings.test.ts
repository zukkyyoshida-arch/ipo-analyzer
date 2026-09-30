import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EdinetFatalError, type EdinetApi, type EdinetDocMeta } from "../scripts/updater/edinet";
import { intradayHoldingsKey, HOLDINGS_INTRADAY_TTL_SECONDS } from "@/lib/holdings/intraday";
import { runIntradayHoldings, type IntradayKvStore } from "./run-intraday-holdings";

const FIXTURES = path.join(__dirname, "..", "scripts", "updater", "__fixtures__");
const ZIP_NEW = readFileSync(path.join(FIXTURES, "lvh-new-single.zip")); // 発行者 4436・新規 16.38%
const ZIP_CHANGE = readFileSync(path.join(FIXTURES, "lvh-change-joint.zip")); // 発行者 4436・16.46% → 16.04%

// 2026-10-01 10:00 JST
const NOW = new Date("2026-10-01T01:00:00Z");
const TODAY = "2026-10-01";
const base = [{ code: "4436", name: "ミンカブ", listingDate: "2019-12-19" }];
const issuers = { E34754: "4436" };

function doc(p: Partial<EdinetDocMeta> & { docID: string }): EdinetDocMeta {
  return {
    docTypeCode: "350",
    formCode: "010002",
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    csvFlag: "1",
    parentDocID: null,
    issuerEdinetCode: "E34754",
    submitDateTime: `${TODAY} 09:30`,
    ...p,
  };
}

function fakeApi(docs: EdinetDocMeta[], csv: Record<string, Buffer | null>, opts: { failList?: boolean } = {}) {
  const listed: string[] = [];
  const downloaded: string[] = [];
  let n = 0;
  const api: EdinetApi = {
    get requestCount() {
      return n;
    },
    async listDocuments(date) {
      n++;
      if (opts.failList) throw new EdinetFatalError("EDINET 書類一覧: HTTP 401（API キーを確認してください）");
      listed.push(date);
      return docs;
    },
    async fetchCsvZip(docId) {
      n++;
      downloaded.push(docId);
      return csv[docId] ?? null;
    },
  };
  return { api, listed, downloaded };
}

function memoryKv(): IntradayKvStore & { data: Map<string, string>; ttl: Map<string, number | undefined> } {
  const data = new Map<string, string>();
  const ttl = new Map<string, number | undefined>();
  return {
    data,
    ttl,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value, options) {
      data.set(key, value);
      ttl.set(key, options?.expirationTtl);
    },
  };
}

const run = (kv: IntradayKvStore | undefined, api: EdinetApi, maxCsvDownloads?: number) =>
  runIntradayHoldings(
    { HOLDINGS_INTRADAY: kv, EDINET_API_KEY: "dummy" },
    { now: NOW, api, base, auto: [], issuers, maxCsvDownloads, log: () => {} },
  );

describe("runIntradayHoldings", () => {
  it("当日の一覧を 1 本だけ取り、IPO 銘柄あての書類の CSV を取って KV に当日キーで書く", async () => {
    const kv = memoryKv();
    const { api, listed, downloaded } = fakeApi(
      [
        doc({ docID: "S100AAAA", formCode: "010000" }),
        doc({ docID: "S100OTHR", issuerEdinetCode: "E99999" }),
        doc({ docID: "S100YUHO", docTypeCode: "120" }),
      ],
      { S100AAAA: ZIP_NEW },
    );
    const r = await run(kv, api);
    expect(r.status).toBe("ok");
    expect(listed).toEqual([TODAY]);
    expect(downloaded).toEqual(["S100AAAA"]);
    const stored = JSON.parse(kv.data.get(intradayHoldingsKey(TODAY)) ?? "null");
    expect(stored.coveredThrough).toBe(TODAY);
    expect(stored.generatedAt).toBe(NOW.toISOString());
    expect(stored.items.map((it: { docId: string }) => it.docId)).toEqual(["S100AAAA"]);
    expect(stored.items[0]).toMatchObject({ code: "4436", formType: "new", submitDate: TODAY });
    expect(kv.ttl.get(intradayHoldingsKey(TODAY))).toBe(HOLDINGS_INTRADAY_TTL_SECONDS);
  });

  it("CSV の上限で打ち切り、次の回は取得済みの docID を飛ばして続きを取る", async () => {
    const kv = memoryKv();
    const docs = [
      doc({ docID: "S100AAAA", formCode: "010000", submitDateTime: `${TODAY} 09:10` }),
      doc({ docID: "S100BBBB", submitDateTime: `${TODAY} 09:20` }),
    ];
    const first = fakeApi(docs, { S100AAAA: ZIP_NEW, S100BBBB: ZIP_CHANGE });
    const r1 = await run(kv, first.api, 1);
    expect(r1.status).toBe("partial");
    expect(first.downloaded).toEqual(["S100AAAA"]);
    expect(r1.items).toBe(1);

    const second = fakeApi(docs, { S100AAAA: ZIP_NEW, S100BBBB: ZIP_CHANGE });
    const r2 = await run(kv, second.api, 1);
    expect(r2.status).toBe("ok");
    expect(second.downloaded).toEqual(["S100BBBB"]);
    expect(r2.items).toBe(2);
  });

  it("一覧を取れないときは KV を書き換えない", async () => {
    const kv = memoryKv();
    kv.data.set(intradayHoldingsKey(TODAY), "keep");
    const { api } = fakeApi([], {}, { failList: true });
    const r = await run(kv, api);
    expect(r.status).toBe("partial");
    expect(kv.data.get(intradayHoldingsKey(TODAY))).toBe("keep");
  });

  it("KV・API キーが無ければ何もしない", async () => {
    const { api, listed } = fakeApi([], {});
    expect((await run(undefined, api)).status).toBe("skipped");
    expect(listed).toEqual([]);
    const r = await runIntradayHoldings({ HOLDINGS_INTRADAY: memoryKv() }, { now: NOW, log: () => {} });
    expect(r.status).toBe("skipped");
  });
});
