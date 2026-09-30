import type { Ipo } from "../../src/types/ipo";
import type { QuotePoint } from "../../src/lib/quote";
import { buildHotRanking, type HotCandidate } from "../../src/lib/hot/score";
import { parseHotFile, type HotFile } from "../../src/lib/hot/file";
import type { ChartQuote } from "./prices";
import { jstDateOf } from "./split";
import { readJson, writeJsonIfChanged } from "./io";

// hot.json（いま熱い銘柄）の生成。updater（main.ts）が価格更新で取った日足をそのまま使い、
// Yahoo への追加の取得はしない。スコアの定義は src/lib/hot/score.ts。

/**
 * 当日の日足が確定したとみなす時刻（JST、0時からの分）。東証の大引けは 15:30。
 * これより前に実行したときの当日の足は途中経過なので使わない（夜間ジョブの 2:00 実行では関係しない）。
 */
export const SESSION_FINAL_MINUTES_JST = 16 * 60;

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** Yahoo の日足（Date 付き）を画面と同じ QuotePoint（YYYY-MM-DD）に直す。終値の無い行は捨てる。 */
export function toQuotePoints(quotes: readonly ChartQuote[]): QuotePoint[] {
  return quotes.flatMap((q) =>
    typeof q.close === "number"
      ? [
          {
            date: jstDateOf(q.date),
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
          },
        ]
      : [],
  );
}

/** 実行時刻が大引け前なら、当日（JST）以降の足を除く。 */
export function dropUnfinishedSession(points: readonly QuotePoint[], now: Date): QuotePoint[] {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const today = jst.toISOString().slice(0, 10);
  const minutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  if (minutes >= SESSION_FINAL_MINUTES_JST) return [...points];
  return points.filter((p) => p.date < today);
}

/** マージ済みの銘柄と、code → 日足（updater が取得したもの）からランキングの入力を作る。 */
export function buildHotCandidates(
  ipos: readonly Ipo[],
  charts: ReadonlyMap<string, readonly ChartQuote[]>,
  now: Date,
): HotCandidate[] {
  return ipos.flatMap((ipo) => {
    const chart = charts.get(ipo.code);
    if (!chart || chart.length === 0 || !ipo.listingDate) return [];
    return [
      {
        code: ipo.code,
        name: ipo.name,
        listingDate: ipo.listingDate,
        quotes: dropUnfinishedSession(toQuotePoints(chart), now),
        offeringPrice: ipo.offeringPrice,
        initialPrice: ipo.initialPrice,
        splitFactor: ipo.splitFactor ?? null,
      },
    ];
  });
}

/** hot.json の中身を作る。 */
export function buildHotFile(
  ipos: readonly Ipo[],
  charts: ReadonlyMap<string, readonly ChartQuote[]>,
  now: Date,
): HotFile {
  const ranking = buildHotRanking(buildHotCandidates(ipos, charts, now));
  return {
    asOf: ranking.asOf,
    generatedAt: now.toISOString(),
    universe: ranking.universe,
    items: ranking.items,
  };
}

/** 生成時刻以外が同じか（同じなら書き換えず、夜間ジョブの差分を増やさない）。 */
export function sameHotContent(a: HotFile | null, b: HotFile): boolean {
  if (!a) return false;
  const strip = (f: HotFile) => JSON.stringify({ asOf: f.asOf, universe: f.universe, items: f.items });
  return strip(a) === strip(b);
}

export type HotWriteResult = "written" | "unchanged" | "keptEmpty";

/**
 * hot.json を書く。
 * - 対象が0件（取得の不調など）のときは既存のファイルを残す（古くなれば画面は「更新待ち」になる）。
 * - 生成時刻以外が同じなら書かない。
 */
export async function writeHotFile(filePath: string, next: HotFile): Promise<HotWriteResult> {
  if (next.universe === 0 || next.items.length === 0) return "keptEmpty";
  const current = parseHotFile(await readJson<unknown>(filePath, null));
  if (sameHotContent(current, next)) return "unchanged";
  const written = await writeJsonIfChanged(filePath, next);
  return written ? "written" : "unchanged";
}
