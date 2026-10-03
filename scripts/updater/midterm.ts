import type { Ipo } from "../../src/types/ipo";
import { buildMidFile, parseMidFile, type MidCandidate, type MidFile } from "../../src/lib/midterm/file";
import type { ChartQuote } from "./prices";
import { dropUnfinishedSession, toQuotePoints } from "./hot";
import { MID_LISTING_WINDOW_DAYS } from "../../src/lib/midterm/file";
import { daysBetween } from "../../src/lib/date";
import type { HistoricalIpo } from "../../src/types/history";
import { readJson, writeJsonIfChanged } from "./io";

// midterm.json（中長期セカンダリ: 上場来高値からの下落率・安値・出来高）の生成。
// updater（main.ts）が価格更新で取った日足を使う（履歴由来の 2023 年末上場分だけ main.ts が別に取る）。
// 指標の定義は src/lib/midterm/file.ts。

/** 母集団に足す、Ipo 型を持たない銘柄（過去 IPO 履歴由来）。 */
export type MidExtra = Pick<HistoricalIpo, "code" | "name" | "listingDate">;

/**
 * 過去 IPO 履歴（ipos.history.json。2023 年上場分まで）のうち、上場から 3 年以内で
 * まだ ipos（base＋auto のマージ結果）に無い銘柄。base は 2024 年上場から始まるため、
 * 2023 年末上場分（上場後 3 年以内）の穴をこれで埋める。
 * 履歴由来は Ipo 型が無いので、判定側（rankMidSecondary）ではロックアップ・業績が「不明」になる（許容）。
 */
export function historicalMidTargets(
  history: readonly MidExtra[],
  ipos: readonly Pick<Ipo, "code">[],
  today: string,
): MidExtra[] {
  const known = new Set(ipos.map((i) => i.code));
  return history.filter((h) => {
    if (known.has(h.code) || !/^\d{4}-\d{2}-\d{2}$/.test(h.listingDate)) return false;
    const age = daysBetween(h.listingDate, today);
    return age >= 0 && age <= MID_LISTING_WINDOW_DAYS;
  });
}

/** マージ済みの銘柄（と履歴由来の追加分）と、code → 日足から入力を作る。 */
export function buildMidCandidates(
  ipos: readonly Pick<Ipo, "code" | "name" | "listingDate">[],
  charts: ReadonlyMap<string, readonly ChartQuote[]>,
  now: Date,
  extras: readonly MidExtra[] = [],
): MidCandidate[] {
  return [...ipos, ...extras].flatMap((ipo) => {
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
  extras: readonly MidExtra[] = [],
): MidFile {
  return buildMidFile(buildMidCandidates(ipos, charts, now, extras), now);
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
