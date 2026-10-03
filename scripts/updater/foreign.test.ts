import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ForeignFile } from "../../src/types/foreign";
import { EdinetFatalError, type EdinetApi, type EdinetDocMeta } from "./edinet";
import {
  mergeForeignPeriod,
  parseForeignCsv,
  parseForeignCsvZip,
  updateForeign,
  withDocListCache,
} from "./foreign";
import { decodeCsvBytes } from "./holdingsCsv";
import { readZipEntries } from "./zip";

// 実データ: 2025-06-26 提出の ＯＵＧホールディングス（8041）有報 S100W4I7 の CSV から、
// DEI と所有者別状況の行だけを抜き出したもの（外国法人等 個人以外 0.0349・個人 0.0001、当期末 2025-03-31）。
const FIXTURE = readFileSync(path.join(__dirname, "__fixtures__", "yuho-foreign-oug.zip"));
const FIXTURE_TEXT = decodeCsvBytes(
  readZipEntries(FIXTURE).find((e) => e.name.includes("jpcrp030000-asr"))!.data,
);

/** 無圧縮の ZIP を作る（zip.ts は CRC を見ないので 0 のまま）。 */
function storedZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, f.data);
    centrals.push(central, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** フィクスチャの値（外国法人等の割合・事業年度末・証券コード）を差し替えた ZIP。 */
function variantZip(opts: { other?: string; indiv?: string; fy?: string; sec?: string }): Buffer {
  let text = FIXTURE_TEXT;
  const setValue = (id: string, v: string) => {
    text = text.replace(new RegExp(`("[^"]*:${id}"\\t(?:"[^"]*"\\t){7})"[^"]*"`), `$1"${v}"`);
  };
  if (opts.other !== undefined) setValue("PercentageOfShareholdingsForeignersOtherThanIndividuals", opts.other);
  if (opts.indiv !== undefined) setValue("PercentageOfShareholdingsForeignIndividuals", opts.indiv);
  if (opts.fy !== undefined) setValue("CurrentFiscalYearEndDateDEI", opts.fy);
  if (opts.sec !== undefined) setValue("SecurityCodeDEI", opts.sec);
  const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  return storedZip([{ name: "XBRL_TO_CSV/jpcrp030000-asr-001_E02530-000_2025-03-31_01_2025-06-26.csv", data: body }]);
}

const codeMap = new Map([
  ["E02530", "8041"],
  ["E99999", "9999"],
]);
const targets = new Set(["8041", "9999"]);

function doc(p: Partial<EdinetDocMeta> & { docID: string }): EdinetDocMeta {
  return {
    edinetCode: "E02530",
    docTypeCode: "120",
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    csvFlag: "1",
    submitDateTime: "2025-06-26 15:00",
    periodEnd: "2025-03-31",
    ...p,
  };
}

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

const quiet = () => {};
const NOW = new Date("2026-10-03T00:00:00Z");

describe("parseForeignCsv / parseForeignCsvZip（実データのフィクスチャ）", () => {
  it("外国法人等の個人以外＋個人を足して % にし、当期末と証券コードを読む", () => {
    const r = parseForeignCsvZip(FIXTURE);
    expect(r.ratioPercent).toBe(3.5); // 0.0349 + 0.0001 = 3.50%
    expect(r.context).toBe("CurrentYearInstant_OrdinaryShareMember");
    expect(r.fiscalYearEnd).toBe("2025-03-31");
    expect(r.secCode).toBe("8041");
  });
  it("株主数・単元数の Foreign 要素は使わない", () => {
    expect(parseForeignCsv(FIXTURE_TEXT).ratioPercent).toBeLessThan(100);
  });
  it("「－」は 0 として足す。両方空欄なら 0%", () => {
    expect(parseForeignCsvZip(variantZip({ indiv: "－" })).ratioPercent).toBe(3.49);
    expect(parseForeignCsvZip(variantZip({ other: "－", indiv: "－" })).ratioPercent).toBe(0);
  });
  it("所有者別状況の要素が無ければ null", () => {
    const text = FIXTURE_TEXT.split(/\r?\n/)
      .filter((l) => !l.includes("PercentageOfShareholdingsForeign"))
      .join("\r\n");
    expect(parseForeignCsv(text).ratioPercent).toBeNull();
  });
  it("有報本体の CSV が無い ZIP は例外", () => {
    expect(() => parseForeignCsvZip(storedZip([{ name: "XBRL_TO_CSV/jpaud-aar-cn-001_x.csv", data: Buffer.from("a") }]))).toThrow();
  });
});

describe("mergeForeignPeriod", () => {
  const p = (fy: string, ratio: number, submit = `${fy.slice(0, 4)}-06-26`, docId = `D${fy.slice(0, 4)}`) => ({
    ratioPercent: ratio,
    fiscalYearEnd: fy,
    submitDate: submit,
    docId,
  });
  it("新しい期が来たら当期を前期へずらす（最新 2 期だけ持つ）", () => {
    let it = mergeForeignPeriod(undefined, p("2024-03-31", 8.1));
    it = mergeForeignPeriod(it, p("2025-03-31", 12.3));
    expect(it).toEqual({ ...p("2025-03-31", 12.3), prevRatioPercent: 8.1, prevFiscalYearEnd: "2024-03-31" });
    it = mergeForeignPeriod(it, p("2026-03-31", 15));
    expect(it.prevFiscalYearEnd).toBe("2025-03-31");
    expect(it.prevRatioPercent).toBe(12.3);
  });
  it("同じ期は提出日の新しい方で上書きし、前期は残す", () => {
    let it = mergeForeignPeriod(undefined, p("2024-03-31", 8.1));
    it = mergeForeignPeriod(it, p("2025-03-31", 12.3));
    const later = mergeForeignPeriod(it, p("2025-03-31", 13, "2025-08-01", "DNEW"));
    expect(later).toMatchObject({ ratioPercent: 13, docId: "DNEW", prevRatioPercent: 8.1 });
    const older = mergeForeignPeriod(it, p("2025-03-31", 1, "2025-01-01", "DOLD"));
    expect(older).toBe(it);
  });
  it("古い期が後から来たら前期に入れる（前期より古ければ捨てる）", () => {
    let it = mergeForeignPeriod(undefined, p("2025-03-31", 12.3));
    it = mergeForeignPeriod(it, p("2024-03-31", 8.1));
    expect(it).toMatchObject({ fiscalYearEnd: "2025-03-31", prevFiscalYearEnd: "2024-03-31", prevRatioPercent: 8.1 });
    expect(mergeForeignPeriod(it, p("2023-03-31", 5))).toBe(it);
  });
});

describe("updateForeign", () => {
  it("初回は 2023-01-01 から maxDays 日だけ走査し、scannedThrough を最後の日にする", async () => {
    const api = fakeApi({}, {});
    const { file, stats } = await updateForeign({
      api, existing: null, codeMap, targetCodes: targets, today: "2026-10-03", maxDays: 3, now: NOW, log: quiet,
    });
    expect(api.listed).toEqual(["2023-01-01", "2023-01-02", "2023-01-03"]);
    expect(file.scannedThrough).toBe("2023-01-03");
    expect(stats.days).toBe(3);
  });

  it("次回は scannedThrough の翌日から再開し、前日（JST）で止まる", async () => {
    const existing: ForeignFile = { generatedAt: "x", scannedThrough: "2026-09-30", items: {} };
    const api = fakeApi({}, {});
    const { file } = await updateForeign({
      api, existing, codeMap, targetCodes: targets, today: "2026-10-03", maxDays: 120, now: NOW, log: quiet,
    });
    expect(api.listed).toEqual(["2026-10-01", "2026-10-02"]);
    expect(file.scannedThrough).toBe("2026-10-02");
  });

  it("対象銘柄の有報（120）だけ CSV を取り、訂正有報（130）・対象外・CSV なし・取下げは無視する", async () => {
    const api = fakeApi(
      {
        "2025-06-26": [
          doc({ docID: "S100W4I7" }),
          doc({ docID: "S100AMND", docTypeCode: "130" }),
          doc({ docID: "S100OTHR", edinetCode: "E00001" }),
          doc({ docID: "S100NCSV", edinetCode: "E99999", csvFlag: "0" }),
          doc({ docID: "S100WDRN", edinetCode: "E99999", withdrawalStatus: "2" }),
          doc({ docID: "S100QRTR", docTypeCode: "140" }),
        ],
      },
      { S100W4I7: FIXTURE },
    );
    const { file, stats } = await updateForeign({
      api, existing: { generatedAt: "x", scannedThrough: "2025-06-25", items: {} },
      codeMap, targetCodes: targets, today: "2025-06-27", now: NOW, log: quiet,
    });
    expect(api.downloaded).toEqual(["S100W4I7"]);
    expect(stats.matched).toBe(1);
    expect(file.items).toEqual({
      "8041": { ratioPercent: 3.5, fiscalYearEnd: "2025-03-31", submitDate: "2025-06-26", docId: "S100W4I7" },
    });
    expect(file.scannedThrough).toBe("2025-06-26");
  });

  it("翌年の有報で当期・前期を持ち、同じ期の再提出は新しい提出日で上書きする", async () => {
    const existing: ForeignFile = {
      generatedAt: "x",
      scannedThrough: "2026-06-24",
      items: { "8041": { ratioPercent: 3.5, fiscalYearEnd: "2025-03-31", submitDate: "2025-06-26", docId: "S100W4I7" } },
    };
    const api = fakeApi(
      {
        "2026-06-25": [doc({ docID: "S1002026", submitDateTime: "2026-06-25 15:00", periodEnd: "2026-03-31" })],
        "2026-06-26": [doc({ docID: "S1002027", submitDateTime: "2026-06-26 09:00", periodEnd: "2026-03-31" })],
      },
      {
        S1002026: variantZip({ other: "0.15", indiv: "0.002", fy: "2026-03-31" }),
        S1002027: variantZip({ other: "0.16", indiv: "0.002", fy: "2026-03-31" }),
      },
    );
    const { file } = await updateForeign({
      api, existing, codeMap, targetCodes: targets, today: "2026-06-27", now: NOW, log: quiet,
    });
    expect(file.items["8041"]).toEqual({
      ratioPercent: 16.2,
      fiscalYearEnd: "2026-03-31",
      submitDate: "2026-06-26",
      docId: "S1002027",
      prevRatioPercent: 3.5,
      prevFiscalYearEnd: "2025-03-31",
    });
  });

  it("取得に失敗したら、取り終えた日までしか scannedThrough を進めない", async () => {
    const api = fakeApi({}, {}, { failListOn: "2025-06-28" });
    const { file, stats } = await updateForeign({
      api, existing: { generatedAt: "x", scannedThrough: "2025-06-25", items: {} },
      codeMap, targetCodes: targets, today: "2025-07-10", now: NOW, log: quiet,
    });
    expect(file.scannedThrough).toBe("2025-06-27");
    expect(stats.stoppedReason).toContain("401");
  });

  it("CSV の取得に失敗したら、その日は取り終えていない扱い", async () => {
    const api = fakeApi({ "2025-06-26": [doc({ docID: "S100W4I7" })] }, {});
    const { file, stats } = await updateForeign({
      api, existing: { generatedAt: "x", scannedThrough: "2025-06-25", items: {} },
      codeMap, targetCodes: targets, today: "2025-06-28", now: NOW, log: quiet,
    });
    expect(file.scannedThrough).toBe("2025-06-25");
    expect(stats.stoppedReason).toContain("想定外");
  });

  it("FOREIGN_FROM で先へ飛んだときは項目だけ足し、scannedThrough は進めない（穴を作らない）", async () => {
    const api = fakeApi({ "2025-06-26": [doc({ docID: "S100W4I7" })] }, { S100W4I7: FIXTURE });
    const { file } = await updateForeign({
      api, existing: null, codeMap, targetCodes: targets, today: "2026-10-03",
      from: "2025-06-26", maxDays: 2, now: NOW, log: quiet,
    });
    expect(api.listed).toEqual(["2025-06-26", "2025-06-27"]);
    expect(file.items["8041"]?.ratioPercent).toBe(3.5);
    expect(file.scannedThrough).toBe("2022-12-31");
  });

  it("CSV なし（404）は数えて飛ばす", async () => {
    const api = fakeApi({ "2025-06-26": [doc({ docID: "S100W4I7" })] }, { S100W4I7: null });
    const { file, stats } = await updateForeign({
      api, existing: { generatedAt: "x", scannedThrough: "2025-06-25", items: {} },
      codeMap, targetCodes: targets, today: "2025-06-27", now: NOW, log: quiet,
    });
    expect(stats.csvMissing).toBe(1);
    expect(file.items).toEqual({});
    expect(file.scannedThrough).toBe("2025-06-26");
  });
});

describe("withDocListCache", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  it("今日より前の日の一覧はキャッシュから返し、二度取りしない（当日分はキャッシュしない）", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "foreign-cache-"));
    const inner = fakeApi(
      { "2025-06-26": [doc({ docID: "S100W4I7", filerName: "ＯＵＧ" })], "2025-06-27": [] },
      {},
    );
    const api = withDocListCache(inner, dir, "2025-06-27");
    const first = await api.listDocuments("2025-06-26");
    const second = await api.listDocuments("2025-06-26");
    await api.listDocuments("2025-06-27");
    await api.listDocuments("2025-06-27");
    expect(inner.listed).toEqual(["2025-06-26", "2025-06-27", "2025-06-27"]);
    expect(second).toEqual(first);
    expect(first[0].docID).toBe("S100W4I7");
    expect(api.cacheHits).toBe(1);
  });
});
