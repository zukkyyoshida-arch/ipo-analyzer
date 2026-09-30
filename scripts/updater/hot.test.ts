import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Ipo } from "../../src/types/ipo";
import type { HotFile } from "../../src/lib/hot/file";
import type { ChartQuote } from "./prices";
import {
  buildHotCandidates,
  buildHotFile,
  dropUnfinishedSession,
  sameHotContent,
  toQuotePoints,
  writeHotFile,
} from "./hot";

/** Yahoo の日足と同じく JST 9:00（UTC 0:00）の時刻。 */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function quote(iso: string, close: number | null, volume = 100_000): ChartQuote {
  return { date: day(iso), open: close, high: close, low: close, close, volume };
}

/** 2026-09-01 から毎日 n 本（close は 1000 から step ずつ）。 */
function chart(n: number, step: number): ChartQuote[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1 + i));
    return quote(d.toISOString().slice(0, 10), 1000 + step * i);
  });
}

function ipo(code: string, overrides: Partial<Ipo> = {}): Ipo {
  return {
    code,
    name: `銘柄${code}`,
    listingDate: "2026-06-01",
    offeringPrice: 1000,
    initialPrice: 1200,
    splitFactor: 1,
    ...overrides,
  } as Ipo;
}

describe("toQuotePoints", () => {
  it("日付を JST の YYYY-MM-DD にし、終値の無い行は捨てる", () => {
    const points = toQuotePoints([quote("2026-09-28", 1000), quote("2026-09-29", null)]);
    expect(points).toEqual([
      { date: "2026-09-28", open: 1000, high: 1000, low: 1000, close: 1000, volume: 100_000 },
    ]);
  });
});

describe("dropUnfinishedSession", () => {
  const points = toQuotePoints([quote("2026-09-29", 1000), quote("2026-09-30", 1100)]);

  it("大引け前（JST 16:00 より前）の実行では当日の足を除く", () => {
    // JST 2026-09-30 13:30 = UTC 04:30
    expect(dropUnfinishedSession(points, new Date("2026-09-30T04:30:00Z")).map((p) => p.date)).toEqual([
      "2026-09-29",
    ]);
  });

  it("JST 16:00 以降と、夜間（翌日 2:00）の実行では全部使う", () => {
    expect(dropUnfinishedSession(points, new Date("2026-09-30T07:00:00Z"))).toHaveLength(2);
    // JST 2026-10-01 02:00 = UTC 2026-09-30 17:00
    expect(dropUnfinishedSession(points, new Date("2026-09-30T17:00:00Z"))).toHaveLength(2);
  });
});

describe("buildHotCandidates / buildHotFile", () => {
  const now = new Date("2026-09-30T17:00:00Z");

  it("日足のある銘柄だけを入力にし、公開価格・初値・分割係数を引き継ぐ", () => {
    const charts = new Map([["1111", chart(30, 10)]]);
    const candidates = buildHotCandidates(
      [ipo("1111", { splitFactor: 2 }), ipo("2222"), ipo("3333", { listingDate: "" })],
      charts,
      now,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      code: "1111",
      name: "銘柄1111",
      listingDate: "2026-06-01",
      offeringPrice: 1000,
      initialPrice: 1200,
      splitFactor: 2,
    });
    expect(candidates[0].quotes).toHaveLength(30);
  });

  it("hot.json の形（asOf・generatedAt・universe・items）", () => {
    const charts = new Map([
      ["1111", chart(30, 10)],
      ["2222", chart(30, 30)],
    ]);
    const file = buildHotFile([ipo("1111"), ipo("2222")], charts, now);
    expect(Object.keys(file)).toEqual(["asOf", "generatedAt", "universe", "items"]);
    expect(file.asOf).toBe("2026-09-30");
    expect(file.generatedAt).toBe(now.toISOString());
    expect(file.universe).toBe(2);
    expect(file.items.map((i) => i.code)).toEqual(["2222", "1111"]);
    expect(file.items[0].initialRatio).toBe(1.2);
  });

  it("各行に日足の本数 bars を書き、上場から日が浅い銘柄は「上場来」のチップにする", () => {
    const charts = new Map([
      // 2222 と同じ 9/30 で終わる 3 本（始値 = 終値のテスト用の足）
      ["1111", [quote("2026-09-28", 1000), quote("2026-09-29", 1100), quote("2026-09-30", 1200)]],
      ["2222", chart(30, 30)],
    ]);
    const file = buildHotFile(
      [ipo("1111", { listingDate: "2026-09-28" }), ipo("2222", { listingDate: "2026-09-01" })],
      charts,
      now,
    );
    const short = file.items.find((i) => i.code === "1111")!;
    const long = file.items.find((i) => i.code === "2222")!;
    expect(short.bars).toBe(3);
    expect(long.bars).toBe(30);
    // 3 本: 始値 1000 → 終値 1200 で +20%（始値が基準）。「上場来」は 1 つだけ
    expect(short.reasons.filter((r) => r.startsWith("上場来 "))).toEqual(["上場来 +20%"]);
    expect(short.reasons.some((r) => r.startsWith("5日") || r.startsWith("20日"))).toBe(false);
    // JSON にした結果も bars を持つ
    expect(JSON.parse(JSON.stringify(file)).items[0]).toHaveProperty("bars");
  });
});

describe("sameHotContent / writeHotFile", () => {
  // テストで作った一時フォルダだけを後片付けする。
  const tempDirs: string[] = [];
  async function tempFile(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "hot-"));
    tempDirs.push(dir);
    return path.join(dir, "hot.json");
  }
  afterAll(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const base: HotFile = {
    asOf: "2026-09-29",
    generatedAt: "2026-09-29T17:00:00.000Z",
    universe: 1,
    items: [
      {
        code: "1111",
        name: "銘柄1111",
        listingDate: "2026-06-01",
        score: 50,
        r5: 0.1,
        r20: 0.2,
        volRatio: 1.5,
        highProx: 0.9,
        turnover5: 1e8,
        initialRatio: 1.2,
        reasons: ["5日 +10%"],
      },
    ],
  };

  it("生成時刻だけ違うなら同じ", () => {
    expect(sameHotContent(base, { ...base, generatedAt: "later" })).toBe(true);
    expect(sameHotContent(base, { ...base, asOf: "2026-09-30" })).toBe(false);
    expect(sameHotContent(null, base)).toBe(false);
  });

  it("中身が同じなら書かず、変わったら書き、対象0件なら既存を残す", async () => {
    const file = await tempFile();

    expect(await writeHotFile(file, base)).toBe("written");
    expect(await writeHotFile(file, { ...base, generatedAt: "later" })).toBe("unchanged");
    expect(JSON.parse(await readFile(file, "utf-8")).generatedAt).toBe(base.generatedAt);

    const next = { ...base, asOf: "2026-09-30", generatedAt: "later" };
    expect(await writeHotFile(file, next)).toBe("written");
    expect(JSON.parse(await readFile(file, "utf-8")).asOf).toBe("2026-09-30");

    expect(await writeHotFile(file, { asOf: "", generatedAt: "x", universe: 0, items: [] })).toBe(
      "keptEmpty",
    );
    expect(JSON.parse(await readFile(file, "utf-8")).asOf).toBe("2026-09-30");
  });

  it("既存のファイルが壊れていても書ける", async () => {
    const file = await tempFile();
    await writeFile(file, "{壊れた", "utf-8");
    expect(await writeHotFile(file, base)).toBe("written");
  });
});
