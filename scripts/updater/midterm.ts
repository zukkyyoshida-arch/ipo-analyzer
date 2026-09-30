import type { Ipo } from "../../src/types/ipo";
import { buildMidFile, parseMidFile, type MidCandidate, type MidFile } from "../../src/lib/midterm/file";
import type { ChartQuote } from "./prices";
import { dropUnfinishedSession, toQuotePoints } from "./hot";
import { readJson, writeJsonIfChanged } from "./io";

// midterm.json（中長期セカンダリ: 上場来高値からの下落率・安値・出来高）の生成。
// updater（main.ts）が価格更新で取った日足をそのまま使い、Yahoo への追加の取得はしない。
// 指標の定義は src/lib/midterm/file.ts。

/** マージ済みの銘柄と、code → 日足から入力を作る。 */
export function buildMidCandidates(
  ipos: readonly Ipo[],
  charts: ReadonlyMap<string, readonly ChartQuote[]>,
  now: Date,
): MidCandidate[] {
  return ipos.flatMap((ipo) => {
    const chart = charts.get(ipo.code);
    if (!chart || chart.length === 0 || !ipo.listingDate) return [];
    return [
      {
        code: ipo.code,
        name: ipo.name,
        listingDate: ipo.listingDate,
        quotes: dropUnfinishedSession(toQuotePoints(chart), now),
      },
    ];
  });
}

/** midterm.json の中身を作る。 */
export function buildMidtermFile(
  ipos: readonly Ipo[],
  charts: ReadonlyMap<string, readonly ChartQuote[]>,
  now: Date,
): MidFile {
  return buildMidFile(buildMidCandidates(ipos, charts, now), now);
}

/** 生成時刻以外が同じか（同じなら書き換えず、夜間ジョブの差分を増やさない）。 */
export function sameMidContent(a: MidFile | null, b: MidFile): boolean {
  if (!a) return false;
  const strip = (f: MidFile) => JSON.stringify({ asOf: f.asOf, universe: f.universe, items: f.items });
  return strip(a) === strip(b);
}

export type MidWriteResult = "written" | "unchanged" | "keptEmpty";

/**
 * midterm.json を書く。
 * - 対象が 0 件（取得の不調など）のときは既存のファイルを残す（古くなれば画面は「更新待ち」になる）。
 *   対象はあるが −40% 以下の銘柄が 0 件なのは正常なので書く。
 * - 生成時刻以外が同じなら書かない。
 */
export async function writeMidtermFile(filePath: string, next: MidFile): Promise<MidWriteResult> {
  if (next.universe === 0) return "keptEmpty";
  const current = parseMidFile(await readJson<unknown>(filePath, null));
  if (sameMidContent(current, next)) return "unchanged";
  const written = await writeJsonIfChanged(filePath, next);
  return written ? "written" : "unchanged";
}
