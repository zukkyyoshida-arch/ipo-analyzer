import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHoldingsFile } from "../../src/lib/holdings/file";
import type { HoldingItem, HoldingsFile } from "../../src/lib/holdings/types";
import { EdinetFatalError, type EdinetApi, type EdinetDocMeta } from "./edinet";
import {
  buildHoldingsUniverse,
  largeHoldingReportsFromHoldings,
  runHoldingsUpdate,
  sameHoldingsContent,
  stringifyHoldingsFile,
  updateHoldings,
  writeHoldingsFile,
} from "./holdings";

const FIXTURES = path.join(__dirname, "__fixtures__");
const zip = (name: string) => readFileSync(path.join(FIXTURES, `${name}.zip`));
const ZIP_NEW = zip("lvh-new-single"); // 発行者 4436・新規 16.38%
const ZIP_CHANGE = zip("lvh-change-joint"); // 発行者 4436・16.46% → 16.04%
const ZIP_AMEND = zip("lvh-amendment-individual"); // 発行者 623A・訂正（訂正前 S100Z0YQ）
const ZIP_BULK = zip("lvh-bulk-transfer-individual"); // 発行者 4920・短期大量譲渡

const universe = buildHoldingsUniverse(
  [
    { code: "623A", name: "ベルテックス", listingDate: "2026-09-18" },
    { code: "4436", name: "ミンカブ", listingDate: "" },
  ],
  [
    { code: "4436", listingDate: "2019-12-19" },
    { code: "4920", name: "日本色材工業研究所", listingDate: "2001-01-01" },
  ],
);
const codeMap = new Map([
  ["E41959", "623A"],
  ["E34754", "4436"],
  ["E01040", "4920"],
]);

function doc(p: Partial<EdinetDocMeta> & { docID: string }): EdinetDocMeta {
  return {
    docTypeCode: "350",
    formCode: "010002",
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    csvFlag: "1",
    parentDocID: null,
    ...p,
  };
}

/** 日付ごとの一覧と docID ごとの ZIP を返す偽の API。 */
function fakeApi(
  lists: Record<string, EdinetDocMeta[]>,
  csv: Record<string, Buffer | null>,
  opts: { failListOn?: string } = {},
): EdinetApi & { listed: string[]; downloaded: string[] } {
  const listed: string[] = [];
  const downloaded: string[] = [];
  let n = 0;
  return {
    listed,
    downloaded,
    get requestCount() {
      return n;
    },
    async listDocuments(date) {
      n++;
      if (opts.failListOn === date) throw new EdinetFatalError("EDINET 書類一覧: HTTP 401（API キーを確認してください）");
      listed.push(date);
      return lists[date] ?? [];
    },
    async fetchCsvZip(docId) {
      n++;
      downloaded.push(docId);
      if (!(docId in csv)) throw new Error(`想定外の docID ${docId}`);
      return csv[docId];
    },
  };
}

const LISTS: Record<string, EdinetDocMeta[]> = {
  "2026-09-24": [
    doc({ docID: "S100Z0YQ", formCode: "010000", issuerEdinetCode: "E41959", filerName: "山田　太郎", submitDateTime: "2026-09-24 15:00" }),
  ],
  "2026-09-29": [
    // 訂正報告書（360）は一覧で先に出ても、350 の後に処理する
    doc({ docID: "S100Z48K", docTypeCode: "360", formCode: "090001", parentDocID: "S100Z0YQ", issuerEdinetCode: "E41959", filerName: "山田　太郎", submitDateTime: "2026-09-29 09:26" }),
    doc({ docID: "S100Z41P", issuerEdinetCode: "E34754", filerName: "ＳＢＩインベストメント株式会社", submitDateTime: "2026-09-29 16:35" }),
    doc({ docID: "S100Z4U9", formCode: "010000", issuerEdinetCode: "E34754", filerName: "株式会社ＮＴＴデータ", submitDateTime: "2026-09-29 14:37" }),
    // 書類情報の修正: 修正前（"2"）は捨て、修正後（"1"）の formCode を使う
    doc({ docID: "S100EDIT", formCode: "010000", docInfoEditStatus: "2", issuerEdinetCode: "E34754", filerName: "株式会社ＮＴＴデータ", submitDateTime: "2026-09-29 09:56" }),
    doc({ docID: "S100EDIT", formCode: "010002", docInfoEditStatus: "1", issuerEdinetCode: "E34754", filerName: "株式会社ＮＴＴデータ", submitDateTime: "2026-09-29 09:56" }),
    // IPO 銘柄でない発行会社・CSV なし・別の書類・取下げは CSV を取らない
    doc({ docID: "S100OTHR", issuerEdinetCode: "E99999", submitDateTime: "2026-09-29 10:00" }),
    doc({ docID: "S100NCSV", issuerEdinetCode: "E34754", csvFlag: "0", submitDateTime: "2026-09-29 10:00" }),
    doc({ docID: "S100YUHO", docTypeCode: "120", formCode: "030000", issuerEdinetCode: "E34754" }),
    doc({ docID: "S100WDRN", withdrawalStatus: "2", issuerEdinetCode: "E34754" }),
  ],
};
const CSV: Record<string, Buffer | null> = {
  S100Z0YQ: ZIP_AMEND,
  S100Z48K: ZIP_AMEND,
  S100Z41P: ZIP_CHANGE,
  S100Z4U9: ZIP_NEW,
  S100EDIT: ZIP_NEW,
  S100BULK: ZIP_BULK,
};

async function initialRun(extra: Partial<Parameters<typeof updateHoldings>[0]> = {}) {
  const api = fakeApi(LISTS, CSV);
  const result = await updateHoldings({
    api,
    existing: null,
    universe,
    codeMap,
    today: "2026-09-30",
    now: new Date("2026-09-30T02:00:00Z"),
    backfillDays: 10,
    log: () => {},
    ...extra,
  });
  return { api, ...result };
}

const byId = (f: HoldingsFile, id: string) => f.items.find((i) => i.docId === id);

describe("updateHoldings（初回のバックフィル）", () => {
  it("前日までの backfillDays 日を 1 日ずつ取り、IPO 銘柄あての 350/360 だけ CSV を取る", async () => {
    const { api, file, stats } = await initialRun();
    expect(api.listed).toEqual([
      "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
      "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29",
    ]);
    // 350 を先（提出時刻順）、360 を後
    expect(api.downloaded).toEqual(["S100Z0YQ", "S100EDIT", "S100Z4U9", "S100Z41P", "S100Z48K"]);
    expect(stats).toMatchObject({ listRequests: 10, csvDownloads: 5, added: 5, amended: 1, stoppedReason: null });
    expect(file.coveredFrom).toBe("2026-09-20");
    expect(file.coveredThrough).toBe("2026-09-29");
    expect(file.generatedAt).toBe("2026-09-30T02:00:00.000Z");
    expect(file.items.map((i) => i.docId).sort()).toEqual(["S100EDIT", "S100Z41P", "S100Z48K", "S100Z4U9"]);
  });

  it("CSV の値と一覧の情報から 1 件を作る（割合は小数・名前は半角に揃える・上場日を持たせる）", async () => {
    const { file } = await initialRun();
    expect(byId(file, "S100Z41P")).toEqual({
      code: "4436",
      name: "ミンカブ",
      docId: "S100Z41P",
      submitDate: "2026-09-29",
      filer: "SBIインベストメント株式会社",
      holders: 3,
      formType: "change",
      ratio: 0.1604,
      prevRatio: 0.1646,
      delta: -0.0042,
      purpose: expect.stringContaining("発行者との業務提携、純投資"),
      shares: 2465800,
      reason: "株券等に関する担保契約等重要な契約の締結及び保有目的の変更",
      obligationDate: "2026-09-17",
      listingDate: "2019-12-19",
    } satisfies HoldingItem);
    expect(byId(file, "S100Z4U9")).toMatchObject({ formType: "new", ratio: 0.1638, prevRatio: null, delta: null });
    expect(byId(file, "S100Z4U9")?.holders).toBeUndefined();
    // 書類情報の修正後の formCode（010002）
    expect(byId(file, "S100EDIT")?.formType).toBe("change");
  });

  it("訂正報告書は訂正前の書類を置き換え、種類と提出日は訂正前のものを引き継ぐ", async () => {
    const { file } = await initialRun();
    expect(byId(file, "S100Z0YQ")).toBeUndefined();
    expect(byId(file, "S100Z48K")).toMatchObject({
      code: "623A",
      formType: "new",
      submitDate: "2026-09-24",
      amendedFrom: "S100Z0YQ",
      ratio: 0.6676,
      listingDate: "2026-09-18",
      filer: "山田 太郎",
    });
  });

  it("訂正前の書類を持っていないときは、CSV の表紙の提出日と中身から種類を推す", async () => {
    const api = fakeApi({ "2026-09-29": [LISTS["2026-09-29"][0]] }, CSV);
    const { file, stats } = await updateHoldings({
      api, existing: null, universe, codeMap, today: "2026-09-30", backfillDays: 10, log: () => {},
    });
    expect(stats.amended).toBe(0);
    expect(byId(file, "S100Z48K")).toMatchObject({ formType: "new", submitDate: "2026-09-24", amendedFrom: "S100Z0YQ" });
    // 訂正前の提出日が保存期間の外なら落とす
    const api2 = fakeApi({ "2026-09-29": [LISTS["2026-09-29"][0]] }, CSV);
    const short = await updateHoldings({
      api: api2, existing: null, universe, codeMap, today: "2026-09-30", backfillDays: 2, log: () => {},
    });
    expect(short.file.items).toEqual([]);
  });
});

describe("updateHoldings（2 回目以降）", () => {
  it("前回の翌日から前日までを取り、直近 7 日は一覧だけ取り直して取下げを反映する（新しい書類は足さない）", async () => {
    const first = await initialRun();
    const lists: Record<string, EdinetDocMeta[]> = {
      ...LISTS,
      "2026-09-28": [doc({ docID: "S100LATE", issuerEdinetCode: "E34754", submitDateTime: "2026-09-28 10:00" })],
      "2026-09-29": [...LISTS["2026-09-29"], doc({ docID: "S100Z41P", withdrawalStatus: "2", issuerEdinetCode: "E34754" })],
      "2026-09-30": [doc({ docID: "S100BULK", formCode: "020002", issuerEdinetCode: "E01040", filerName: "鈴木　一郎", submitDateTime: "2026-09-30 16:00" })],
    };
    const api = fakeApi(lists, CSV);
    const { file, stats } = await updateHoldings({
      api, existing: first.file, universe, codeMap, today: "2026-10-01", backfillDays: 10, log: () => {},
    });
    expect(api.listed).toEqual([
      "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
    ]);
    expect(api.downloaded).toEqual(["S100BULK"]);
    expect(stats.withdrawn).toBe(1);
    expect(byId(file, "S100Z41P")).toBeUndefined();
    expect(byId(file, "S100LATE")).toBeUndefined();
    expect(byId(file, "S100BULK")).toMatchObject({ code: "4920", formType: "bulkTransfer", ratio: 0.0043, prevRatio: null });
    expect(file.coveredThrough).toBe("2026-09-30");
    // 訂正で置き換えた書類は、取り直しても戻らない
    expect(byId(file, "S100Z0YQ")).toBeUndefined();
    // 窓（10 日）から外れた coveredFrom は進む
    expect(file.coveredFrom).toBe("2026-09-21");
  });

  it("同じ日に 2 回走らせても余計に叩かない", async () => {
    const first = await initialRun();
    const api = fakeApi(LISTS, CSV);
    const { file } = await updateHoldings({
      api, existing: first.file, universe, codeMap, today: "2026-09-30", backfillDays: 10, log: () => {},
    });
    expect(api.requestCount).toBe(0);
    expect(sameHoldingsContent(first.file, file)).toBe(true);
  });

  it("保存期間より前の提出は落とす", async () => {
    const first = await initialRun();
    const api = fakeApi({}, CSV);
    const { file, stats } = await updateHoldings({
      api, existing: first.file, universe, codeMap, today: "2026-10-05", backfillDays: 10, log: () => {},
    });
    // 窓は 09-25〜10-04。09-24 扱いの訂正（S100Z48K）が落ちる
    expect(stats.pruned).toBe(1);
    expect(byId(file, "S100Z48K")).toBeUndefined();
    expect(file.coveredFrom).toBe("2026-09-25");
    expect(file.coveredThrough).toBe("2026-10-04");
  });
});

describe("updateHoldings（打ち切り）", () => {
  it("CSV の上限に達したらその日の途中で止め、coveredThrough は前日まで。次の回で続きから取る", async () => {
    const stopped = await initialRun({ maxCsvDownloads: 2 });
    expect(stopped.stats.stoppedReason).toMatch(/CSV の上限/);
    expect(stopped.file.coveredThrough).toBe("2026-09-28");
    expect(stopped.api.downloaded).toEqual(["S100Z0YQ", "S100EDIT"]);

    const api = fakeApi(LISTS, CSV);
    const resumed = await updateHoldings({
      api, existing: stopped.file, universe, codeMap, today: "2026-09-30", backfillDays: 10, log: () => {},
    });
    expect(api.downloaded).toEqual(["S100Z4U9", "S100Z41P", "S100Z48K"]);
    expect(resumed.file.coveredThrough).toBe("2026-09-29");
    expect(resumed.file.items.map((i) => i.docId).sort()).toEqual(["S100EDIT", "S100Z41P", "S100Z48K", "S100Z4U9"]);
  });

  it("一覧の取得に失敗したら止め、取れた日まで進める", async () => {
    const api = fakeApi(LISTS, CSV, { failListOn: "2026-09-26" });
    const { file, stats } = await updateHoldings({
      api, existing: null, universe, codeMap, today: "2026-09-30", backfillDays: 10, log: () => {},
    });
    expect(stats.stoppedReason).toMatch(/401/);
    expect(file.coveredThrough).toBe("2026-09-25");
    expect(file.items.map((i) => i.docId)).toEqual(["S100Z0YQ"]);
  });

  it("一覧の上限に達したら止める", async () => {
    const { file, stats } = await initialRun({ maxListRequests: 3 });
    expect(stats.stoppedReason).toMatch(/書類一覧の上限/);
    expect(file.coveredThrough).toBe("2026-09-22");
  });

  it("CSV が無い（null）書類は数えて飛ばす", async () => {
    const api = fakeApi(LISTS, { ...CSV, S100Z4U9: null });
    const { file, stats } = await updateHoldings({
      api, existing: null, universe, codeMap, today: "2026-09-30", backfillDays: 10, log: () => {},
    });
    expect(stats.csvMissing).toBe(1);
    expect(byId(file, "S100Z4U9")).toBeUndefined();
    expect(file.coveredThrough).toBe("2026-09-29");
  });
});

describe("largeHoldingReportsFromHoldings", () => {
  it("直近 7 日の提出から銘柄ごとに最新 1 件（提出日・提出者）", async () => {
    const { file } = await initialRun();
    const reports = largeHoldingReportsFromHoldings(file.items, "2026-09-30");
    expect(reports.get("4436")).toEqual({ date: "2026-09-29", holder: expect.any(String) });
    expect(reports.get("623A")).toEqual({ date: "2026-09-24", holder: "山田 太郎" });
    expect(largeHoldingReportsFromHoldings(file.items, "2026-10-10").size).toBe(0);
  });
});

describe("buildHoldingsUniverse", () => {
  it("base を優先し、欠けた社名・上場日を auto で埋める", () => {
    expect(universe.get("4436")).toEqual({ code: "4436", name: "ミンカブ", listingDate: "2019-12-19" });
    expect(universe.get("4920")).toEqual({ code: "4920", name: "日本色材工業研究所", listingDate: "2001-01-01" });
  });
});

describe("書き出し", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(path.join(tmpdir(), "holdings-"));
    dirs.push(d);
    return d;
  };

  it("1 件 1 行の JSON で、読み戻すと同じ中身になる", async () => {
    const { file } = await initialRun();
    const text = stringifyHoldingsFile(file);
    expect(text.split("\n").filter((l) => l.startsWith('    {"code"'))).toHaveLength(file.items.length);
    expect(parseHoldingsFile(JSON.parse(text))).toEqual(file);
  });

  it("生成時刻だけが違うなら書かない", async () => {
    const { file } = await initialRun();
    const p = path.join(tmp(), "holdings.json");
    expect(await writeHoldingsFile(p, file)).toBe(true);
    expect(await writeHoldingsFile(p, { ...file, generatedAt: "2026-10-01T00:00:00.000Z" })).toBe(false);
    expect(await writeHoldingsFile(p, { ...file, items: file.items.slice(1) })).toBe(true);
  });

  it("EDINET_API_KEY が無ければ何もせず、既存の holdings.json を残す", async () => {
    const p = path.join(tmp(), "holdings.json");
    writeFileSync(p, "{ broken", "utf-8");
    const r = await runHoldingsUpdate({ base: [], auto: [], today: "2026-09-30", apiKey: "", filePath: p });
    expect(r.status).toBe("skipped");
    expect(r.written).toBe(false);
    expect(r.requests).toBe(0);
    expect(readFileSync(p, "utf-8")).toBe("{ broken");
  });
});
