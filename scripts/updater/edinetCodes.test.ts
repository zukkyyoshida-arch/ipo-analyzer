import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EDINET_CODE_LIST_CACHE_FILE,
  loadEdinetCodeMap,
  parseEdinetCodeList,
  parseEdinetCodeZip,
} from "./edinetCodes";

// fixture は 2026-09-30 に取った実物の Edinetcode.zip（Shift_JIS・CRLF）から、見出し 2 行と 6 社の行を抜き出したもの。
const SAMPLE_ZIP = readFileSync(path.join(__dirname, "__fixtures__", "edinetcode-sample.zip"));

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "edinet-codes-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeFetch(body: Buffer | null, status = 200): { fn: typeof fetch; calls: () => number } {
  let n = 0;
  const fn = (async () => {
    n++;
    if (body === null) throw new Error("network down");
    return new Response(new Uint8Array(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls: () => n };
}

describe("parseEdinetCodeZip（実データの抜粋）", () => {
  it("EDINET コード → 4 桁の証券コード。英字名のカンマ・英数字コード・証券コードなしを扱う", () => {
    const map = parseEdinetCodeZip(SAMPLE_ZIP);
    expect(map.get("E39382")).toBe("135A"); // 英字名 "VRAIN Solution, Inc." にカンマ
    expect(map.get("E41959")).toBe("623A");
    expect(map.get("E34754")).toBe("4436");
    expect(map.get("E01040")).toBe("4920");
    expect(map.has("E10227")).toBe(false); // 非上場の提出者（証券コードなし）
    expect(map.has("E00017")).toBe(false);
  });

  it("見出しが無ければ例外", () => {
    expect(() => parseEdinetCodeList("a,b,c\r\n1,2,3\r\n")).toThrow();
  });
});

describe("loadEdinetCodeMap", () => {
  const now = new Date("2026-09-30T00:00:00Z");

  it("キャッシュが無ければ取ってキャッシュに置く", async () => {
    const dir = tempDir();
    const f = fakeFetch(SAMPLE_ZIP);
    const r = await loadEdinetCodeMap({ cacheDir: dir, now, fetchImpl: f.fn, log: () => {} });
    expect(r.from).toBe("download");
    expect(r.requests).toBe(1);
    expect(r.map.get("E41959")).toBe("623A");
    expect(readFileSync(path.join(dir, EDINET_CODE_LIST_CACHE_FILE)).equals(SAMPLE_ZIP)).toBe(true);
  });

  it("7 日以内のキャッシュがあれば取りに行かない", async () => {
    const dir = tempDir();
    const file = path.join(dir, EDINET_CODE_LIST_CACHE_FILE);
    writeFileSync(file, SAMPLE_ZIP);
    const recent = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
    utimesSync(file, recent, recent);
    const f = fakeFetch(SAMPLE_ZIP);
    const r = await loadEdinetCodeMap({ cacheDir: dir, now, fetchImpl: f.fn, log: () => {} });
    expect(r.from).toBe("cache");
    expect(f.calls()).toBe(0);
  });

  it("古いキャッシュは取り直し、取れなければ古いキャッシュを使う", async () => {
    const dir = tempDir();
    const file = path.join(dir, EDINET_CODE_LIST_CACHE_FILE);
    writeFileSync(file, SAMPLE_ZIP);
    const old = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
    utimesSync(file, old, old);
    const down = fakeFetch(null);
    const r = await loadEdinetCodeMap({ cacheDir: dir, now, fetchImpl: down.fn, log: () => {} });
    expect(down.calls()).toBe(1);
    expect(r.from).toBe("staleCache");
    expect(r.map.get("E34754")).toBe("4436");
  });

  it("キャッシュも無く取れなければ例外", async () => {
    const dir = tempDir();
    await expect(
      loadEdinetCodeMap({ cacheDir: dir, now, fetchImpl: fakeFetch(Buffer.from("x"), 500).fn, log: () => {} }),
    ).rejects.toThrow(/EDINET コードリスト/);
  });
});
