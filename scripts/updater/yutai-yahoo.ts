import YahooFinance from "yahoo-finance2";
import { jstDateIso } from "./yutai";

// 優待銘柄の決算まわりを Yahoo Finance（yahoo-finance2）から取る。
// - 直近決算の増益／減益: quoteSummary の incomeStatementHistoryQuarterly は 2024 年 11 月以降ほぼ空（ライブラリも
//   fundamentalsTimeSeries を勧めている）ので、fundamentalsTimeSeries（quarterly・financials）の 3M 行を使う。
//   営業利益 → 純利益 → 1 株利益の順に、直近の四半期と前年同期の両方が取れる指標で前年同期比を出す。
// - 決算発表予定日（JPX に無い銘柄の補い）: quoteSummary の calendarEvents の earningsDate。

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface ProfitTrend {
  profitTrend: "up" | "down" | null;
  /** 直近四半期末（YYYY-MM-DD） */
  profitAsOf: string | null;
  /** 前年同期比（比率）。前年同期が 0 以下なら null */
  profitChange: number | null;
  profitBasis: "operating" | "net" | "eps" | null;
}

export const EMPTY_PROFIT: ProfitTrend = { profitTrend: null, profitAsOf: null, profitChange: null, profitBasis: null };

/** fundamentalsTimeSeries の 1 行（使う項目だけ）。 */
export interface FinancialsRow {
  date: Date | string;
  periodType?: string;
  operatingIncome?: number;
  totalOperatingIncomeAsReported?: number;
  netIncome?: number;
  netIncomeCommonStockholders?: number;
  dilutedEPS?: number;
  basicEPS?: number;
}

const BASES: { basis: NonNullable<ProfitTrend["profitBasis"]>; pick: (r: FinancialsRow) => number | undefined }[] = [
  { basis: "operating", pick: (r) => r.operatingIncome ?? r.totalOperatingIncomeAsReported },
  { basis: "net", pick: (r) => r.netIncome ?? r.netIncomeCommonStockholders },
  { basis: "eps", pick: (r) => r.dilutedEPS ?? r.basicEPS },
];

const isoOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** 3M（四半期）の行から、直近四半期の前年同期比を出す。純関数。 */
export function pickProfitTrend(rows: FinancialsRow[]): ProfitTrend {
  const q = rows
    .filter((r) => (r.periodType ?? "3M") === "3M" && !Number.isNaN(new Date(r.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (let i = q.length - 1; i >= 0; i--) {
    const cur = q[i];
    const curT = new Date(cur.date).getTime();
    // 前年同期: 約 1 年前（±20 日）の四半期末
    const prev = q.find((r) => Math.abs(curT - new Date(r.date).getTime() - 365 * 86_400_000) <= 20 * 86_400_000);
    if (!prev) continue;
    for (const { basis, pick } of BASES) {
      const c = pick(cur);
      const p = pick(prev);
      if (typeof c !== "number" || typeof p !== "number" || !Number.isFinite(c) || !Number.isFinite(p)) continue;
      if (c === p) return { profitTrend: null, profitAsOf: isoOf(cur.date), profitChange: 0, profitBasis: basis };
      return {
        profitTrend: c > p ? "up" : "down",
        profitAsOf: isoOf(cur.date),
        profitChange: p > 0 ? Math.round((c / p - 1) * 10_000) / 10_000 : null,
        profitBasis: basis,
      };
    }
    // 最新の四半期で比べられる指標が無ければ、古い四半期へは遡らない（「直近」でなくなる）
    break;
  }
  return EMPTY_PROFIT;
}

/** 1 銘柄の直近決算の前年同期比。取れなければ全部 null。 */
export async function fetchProfitTrend(code: string, now: Date): Promise<ProfitTrend> {
  const period1 = new Date(now.getTime() - 800 * 86_400_000);
  const rows = (await yf.fundamentalsTimeSeries(`${code}.T`, { period1, type: "quarterly", module: "financials" })) as unknown as FinancialsRow[];
  return pickProfitTrend(Array.isArray(rows) ? rows : []);
}

/** calendarEvents.earnings.earningsDate の配列から、today 以降で最も早い日（JST の YYYY-MM-DD）。無ければ null。純関数。 */
export function pickYahooEarningsDate(dates: (Date | string)[] | undefined, todayIso: string): string | null {
  const list = (dates ?? [])
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => jstDateIso(d))
    .filter((d) => d >= todayIso)
    .sort();
  return list[0] ?? null;
}

/** 1 銘柄の決算発表予定日（Yahoo）。無ければ null。 */
export async function fetchYahooEarningsDate(code: string, now: Date): Promise<string | null> {
  const r = await yf.quoteSummary(`${code}.T`, { modules: ["calendarEvents"] });
  return pickYahooEarningsDate(r.calendarEvents?.earnings?.earningsDate as (Date | string)[] | undefined, jstDateIso(now));
}
