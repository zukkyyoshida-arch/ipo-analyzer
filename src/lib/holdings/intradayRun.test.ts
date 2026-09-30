import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EdinetApi, EdinetDocMeta } from "@/lib/edinet/client";
import {
  INTRADAY_HOLDINGS_CRON,
  INTRADAY_MAX_RETRIES,
  isIntradayHoldingsCron,
  runIntradayHoldings,
  type IntradayKvStore,
} from "../../../worker/intraday-holdings";
import { HOLDINGS_INTRADAY_TTL_SECONDS, intradayHoldingsKey, parseIntradayState, type HoldingsIssuersFile } from "./intraday";

// 日中取得（worker/intraday-holdings.ts）の結合テスト。EDINET は偽物、KV はメモリ、CSV は夜間と同じ実物の ZIP。

const FIXTURES = path.join(__dirname, "../../../scripts/updater/__fixtures__");
const zip = (name: string) => readFileSync(path.join(FIXTURES, `${name}.zip`));
const ZIP_NEW = zip("lvh-new-single"); // 発行者 4436・新規 16.38%
const ZIP_CHANGE = zip("lvh-change-joint"); // 発行者 4436・16.46% → 16.04%

const NOW = new Date("2026-09-30T02:00:00Z"); // JST 2026-09-30 11:00
const TODAY = "2026-09-30";

const ISSUERS: HoldingsIssuersFile = {
  generatedAt: "",
  items: [{ edinetCode: "E34754", code: "4436", name: "ミンカブ", listingDate: "2019-12-19" }],
};

function doc(p: Partial<EdinetDocMeta> & { docID: string }): EdinetDocMeta {
  return {
    docTypeCode: "350",
    formCode: "010002",
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    csvFlag: "1",
    parentDocID: null,
    issuerEdinetCode: "E34754",
    submitDateTime: `${TODAY} 10:00`,
    ...p,
  };
}

function fakeApi(docs: EdinetDocMeta[], csv: Record<string, Buffer | null>): EdinetApi & { downloaded: string[] } {
  const downloaded: string[] = [];
  let n = 0;
  return {
    downloaded,
    get requestCount() {
      return n;
    },
    async listDocuments(date) {
      n++;
      if (date !== TODAY) throw new Error(`想定外の日付 ${date}`);
      return docs;
    },
    async fetchCsvZip(docId) {
      n++;
      downloaded.push(docId);
      return csv[docId] ?? null;
    },
  };
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

const quiet = () => {};

describe("cron の振り分け", () => {
  it("平日日中の cron だけ日中取得に回す", () => {
    expect(isIntradayHoldingsCron(INTRADAY_HOLDINGS_CRON)).toBe(true);
    expect(isIntradayHoldingsCron("0 23 * * *")).toBe(false);
    expect(isIntradayHoldingsCron("")).toBe(false);
  });

  it("Cloudflare の曜日（1＝日曜）で誤らないよう MON-FRI で書き、wrangler.jsonc と一致する", () => {
    expect(INTRADAY_HOLDINGS_CRON).toBe("0 0-8 * * MON-FRI");
    const wrangler = readFileSync(path.join(__dirname, "../../../wrangler.jsonc"), "utf-8");
    expect(wrangler).toContain(`"${INTRADAY_HOLDINGS_CRON}"`);
  });
});

describe("runIntradayHoldings", () => {
  it("EDINET_API_KEY が無ければ何もしない", async () => {
    const kv = memoryKv();
    const api = fakeApi([], {});
    const r = await runIntradayHoldings({ PUSH_SUBSCRIPTIONS: kv }, { now: NOW, api, log: quiet, loadIssuers: async () => ISSUERS });
    expect(r.status).toBe("skipped");
    expect(api.requestCount).toBe(0);
    expect(kv.data.size).toBe(0);
  });

  it("KV・写像が無ければ何もしない", async () => {
    const api = fakeApi([], {});
    const noKv = await runIntradayHoldings({ EDINET_API_KEY: "k" }, { now: NOW, api, log: quiet, loadIssuers: async () => ISSUERS });
    expect(noKv.status).toBe("skipped");
    const kv = memoryKv();
    const noIssuers = await runIntradayHoldings(
      { EDINET_API_KEY: "k", PUSH_SUBSCRIPTIONS: kv },
      { now: NOW, api, log: quiet, loadIssuers: async () => null },
    );
    expect(noIssuers.status).toBe("skipped");
    expect(api.requestCount).toBe(0);
    expect(kv.data.size).toBe(0);
  });

  it("IPO 銘柄あての当日分だけ CSV を取り、KV に TTL つきで置く。2 回目は取り直さない", async () => {
    const docs = [
      doc({ docID: "S100NEW1", formCode: "010000", filerName: "株式会社ＮＴＴデータ" }),
      doc({ docID: "S100CHG1", filerName: "ＳＢＩインベストメント株式会社", submitDateTime: `${TODAY} 11:00` }),
      doc({ docID: "S100OTHR", issuerEdinetCode: "E99999" }),
      doc({ docID: "S100NCSV", csvFlag: "0" }),
      doc({ docID: "S100YUHO", docTypeCode: "120" }),
    ];
    const kv = memoryKv();
    const env = { EDINET_API_KEY: "secret-key", PUSH_SUBSCRIPTIONS: kv };
    const api = fakeApi(docs, { S100NEW1: ZIP_NEW, S100CHG1: ZIP_CHANGE });
    const logs: string[] = [];
    const r = await runIntradayHoldings(env, { now: NOW, api, log: (m) => logs.push(m), loadIssuers: async () => ISSUERS });
    expect(r.status).toBe("ok");
    expect(api.downloaded).toEqual(["S100NEW1", "S100CHG1"]);
    expect(r.added).toBe(2);
    const key = intradayHoldingsKey(TODAY);
    expect(kv.ttl.get(key)).toBe(HOLDINGS_INTRADAY_TTL_SECONDS);
    const saved = parseIntradayState(kv.data.get(key) ?? null, TODAY);
    expect(saved?.fetchedAt).toBe(NOW.toISOString());
    expect(saved?.items.map((i) => [i.docId, i.code, i.formType, i.submitDate])).toEqual(
      expect.arrayContaining([
        ["S100NEW1", "4436", "new", TODAY],
        ["S100CHG1", "4436", "change", TODAY],
      ]),
    );
    expect(logs.join("\n")).not.toContain("secret-key");

    // 次の時間: 取り下げが 1 件出る。処理済みは取り直さない
    const api2 = fakeApi([...docs, doc({ docID: "S100WDRN", withdrawalStatus: "1", parentDocID: "S100CHG1" })], {});
    const r2 = await runIntradayHoldings(env, { now: NOW, api: api2, log: quiet, loadIssuers: async () => ISSUERS });
    expect(api2.downloaded).toEqual([]);
    expect(r2.withdrawn).toBe(1);
    const saved2 = parseIntradayState(kv.data.get(key) ?? null, TODAY);
    expect(saved2?.items.map((i) => i.docId)).toEqual(["S100NEW1"]);
    expect(saved2?.withdrawnDocIds).toEqual(["S100CHG1"]);
  });

  it("CSV の上限を超えた分は次の時間に回す", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => doc({ docID: `S100000${i}` }));
    const csv = Object.fromEntries(docs.map((d) => [d.docID, ZIP_CHANGE]));
    const kv = memoryKv();
    const env = { EDINET_API_KEY: "k", PUSH_SUBSCRIPTIONS: kv };
    const api = fakeApi(docs, csv);
    const r = await runIntradayHoldings(env, { now: NOW, api, log: quiet, loadIssuers: async () => ISSUERS, maxCsvPerRun: 3 });
    expect(r.csvDownloads).toBe(3);
    expect(r.deferred).toBe(2);
    const api2 = fakeApi(docs, csv);
    const r2 = await runIntradayHoldings(env, { now: NOW, api: api2, log: quiet, loadIssuers: async () => ISSUERS, maxCsvPerRun: 3 });
    expect(api2.downloaded).toEqual(["S1000003", "S1000004"]);
    expect(r2.deferred).toBe(0);
  });

  it("subrequest の予算（再試行込み）を超えそうなら止める", async () => {
    const docs = Array.from({ length: 30 }, (_, i) => doc({ docID: `S1000${String(i).padStart(3, "0")}` }));
    const csv = Object.fromEntries(docs.map((d) => [d.docID, ZIP_CHANGE]));
    const budget = 10;
    const api = fakeApi(docs, csv);
    const r = await runIntradayHoldings(
      { EDINET_API_KEY: "k", PUSH_SUBSCRIPTIONS: memoryKv() },
      { now: NOW, api, log: quiet, loadIssuers: async () => ISSUERS, maxCsvPerRun: 100, subrequestBudget: budget },
    );
    // 一覧 1 本＋CSV n 本。次の 1 本が再試行込みで予算を超えるなら投げない
    expect(r.subrequests + 1 + INTRADAY_MAX_RETRIES).toBeGreaterThan(budget);
    expect(r.subrequests).toBeLessThanOrEqual(budget);
    expect(r.csvDownloads).toBe(r.subrequests - 1);
    expect(r.deferred).toBe(30 - r.csvDownloads);
  });

  it("既定の上限（CSV 20 本）でも無料枠 50 に収まる", async () => {
    const docs = Array.from({ length: 40 }, (_, i) => doc({ docID: `S1000${String(i).padStart(3, "0")}` }));
    const csv = Object.fromEntries(docs.map((d) => [d.docID, ZIP_CHANGE]));
    const r = await runIntradayHoldings(
      { EDINET_API_KEY: "k", PUSH_SUBSCRIPTIONS: memoryKv() },
      { now: NOW, api: fakeApi(docs, csv), log: quiet, loadIssuers: async () => ISSUERS },
    );
    expect(r.csvDownloads).toBe(20);
    // 写像 1＋一覧 1＋CSV 20 を、それぞれ再試行 1 回まで見込んでも 50 以下
    expect((1 + 1 + r.csvDownloads) * (1 + INTRADAY_MAX_RETRIES)).toBeLessThanOrEqual(50);
  });

  it("写像は ASSETS から読む（未指定時）", async () => {
    const requested: string[] = [];
    const assets = {
      async fetch(input: Request | string) {
        requested.push(typeof input === "string" ? input : input.url);
        return new Response(JSON.stringify(ISSUERS), { headers: { "content-type": "application/json" } });
      },
    };
    const r = await runIntradayHoldings(
      { EDINET_API_KEY: "k", PUSH_SUBSCRIPTIONS: memoryKv(), ASSETS: assets },
      { now: NOW, api: fakeApi([], {}), log: quiet },
    );
    expect(r.status).toBe("ok");
    expect(requested[0]).toMatch(/\/data\/holdings-issuers\.json$/);
    expect(r.subrequests).toBe(2);
  });
});
