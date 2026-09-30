import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Ipo } from "../../src/types/ipo";
import type { ChartQuote } from "./prices";
import { buildMidtermFile, writeMidtermFile } from "./midterm";

function q(iso: string, close: number): ChartQuote {
  return { date: new Date(`${iso}T00:00:00Z`), open: close, high: close, low: close, close, volume: 100_000 };
}

const ipos = [{ code: "111A", name: "下げた", listingDate: "2026-08-01" } as Ipo];
const charts = new Map([
  ["111A", ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"].map((d, i) => q(d, [1000, 700, 500, 400, 380][i]))],
]);

describe("midterm.json の生成", () => {
  const now = new Date("2026-09-30T00:00:00Z");

  it("updater の日足から −40% 以下の銘柄を書く", () => {
    const f = buildMidtermFile(ipos, charts, now);
    expect(f.asOf).toBe("2026-08-07");
    expect(f.items.map((i) => [i.code, i.drawdown])).toEqual([["111A", -0.62]]);
  });

  it("対象 0 件なら既存を残し、同じ中身なら書かない", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "midterm-"));
    const file = path.join(dir, "midterm.json");
    await writeFile(file, "{}");
    expect(await writeMidtermFile(file, buildMidtermFile(ipos, new Map(), now))).toBe("keptEmpty");
    expect(await readFile(file, "utf8")).toBe("{}");
    expect(await writeMidtermFile(file, buildMidtermFile(ipos, charts, now))).toBe("written");
    expect(await writeMidtermFile(file, buildMidtermFile(ipos, charts, new Date()))).toBe("unchanged");
  });
});
