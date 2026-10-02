// 月別ファイル public/data/yutai/<M>.json（株主優待の先回り買い）の読み込み時の検証と、月まわりの小さな整形。純関数。
// 生成は scripts/updater/yutai.ts、型は ./types.ts、候補の並べ替えは src/lib/picks/yutai.ts。

import { daysBetween } from "../date";
import type {
  YutaiBaseline,
  YutaiBaselineYear,
  YutaiBasketResult,
  YutaiBasketStat,
  YutaiBasketYear,
  YutaiCandle,
  YutaiItem,
  YutaiStatus,
  YutaiMonth,
  YutaiMonthFile,
  YutaiRights,
  YutaiRightsBaseline,
  YutaiRightsBaselineYear,
  YutaiRightsYear,
} from "./types";

/** asOf がこの日数以上前なら「古い」とみなす。 */
export const YUTAI_STALE_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCandle(raw: unknown): YutaiCandle | null {
  if (!isRecord(raw)) return null;
  const year = num(raw.year);
  const open = num(raw.open);
  const close = num(raw.close);
  if (year === null || open === null || close === null || open <= 0) return null;
  return { year: Math.round(year), open, close, high: num(raw.high), low: num(raw.low) };
}

/** 年ごとの成績。ファイル上は [年, ret, maxHighRet, hit10 (1/0)] の配列（古い形の {year, ret, hit10, maxHighRet} も読む）。 */
function parseRightsYear(raw: unknown): YutaiRightsYear | null {
  if (Array.isArray(raw)) {
    const [year, ret, maxHighRet, hit, pos, above, draw] = raw.map(num);
    if (year === null || ret === null || maxHighRet === null) return null;
    return {
      year: Math.round(year),
      ret,
      hit10: hit === 1,
      maxHighRet,
      // 古い（短い）配列では要素が undefined になるので null に揃える
      posAtBuy: pos ?? null,
      aboveMa75: above === null || above === undefined ? null : above === 1,
      maxDrawRet: draw ?? null,
    };
  }
  if (!isRecord(raw)) return null;
  const year = num(raw.year);
  const ret = num(raw.ret);
  const maxHighRet = num(raw.maxHighRet);
  if (year === null || ret === null || maxHighRet === null) return null;
  const above = raw.aboveMa75;
  return {
    year: Math.round(year),
    ret,
    hit10: raw.hit10 === true,
    maxHighRet,
    posAtBuy: num(raw.posAtBuy),
    aboveMa75: typeof above === "boolean" ? above : null,
    maxDrawRet: num(raw.maxDrawRet),
  };
}

/** 日足ベースの成績。無い・形が崩れていれば null（古いファイル・日足が取れなかった銘柄）。 */
function parseRights(raw: unknown): YutaiRights | null {
  if (!isRecord(raw)) return null;
  const n10 = num(raw.n10);
  const win10 = num(raw.win10);
  const n5 = num(raw.n5);
  const win5 = num(raw.win5);
  if (n10 === null || win10 === null || n5 === null || win5 === null || n10 <= 0) return null;
  return {
    years: Array.isArray(raw.years)
      ? raw.years.map(parseRightsYear).filter((y): y is YutaiRightsYear => y !== null)
      : [],
    n10,
    win10,
    hit10: num(raw.hit10) ?? 0,
    avgRet10: num(raw.avgRet10),
    avgHighRet10: num(raw.avgHighRet10),
    n5,
    win5,
    winHigh10: num(raw.winHigh10) ?? 0,
    nHigh10: num(raw.nHigh10) ?? 0,
    winLow10: num(raw.winLow10) ?? 0,
    nLow10: num(raw.nLow10) ?? 0,
    winMid10: num(raw.winMid10) ?? 0,
    nMid10: num(raw.nMid10) ?? 0,
    winAbove10: num(raw.winAbove10) ?? 0,
    nAbove10: num(raw.nAbove10) ?? 0,
    winBelow10: num(raw.winBelow10) ?? 0,
    nBelow10: num(raw.nBelow10) ?? 0,
    avgDraw10: num(raw.avgDraw10),
    drawHits: Array.isArray(raw.drawHits) && raw.drawHits.length === 4 ? raw.drawHits.map((v) => num(v) ?? 0) : [0, 0, 0, 0],
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function isoDate(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

function parseItem(raw: unknown): YutaiItem | null {
  if (!isRecord(raw)) return null;
  const { code, name, detailUrl } = raw;
  if (typeof code !== "string" || code === "" || typeof name !== "string") return null;
  const up10 = num(raw.up10);
  const n10 = num(raw.n10);
  const up5 = num(raw.up5);
  const n5 = num(raw.n5);
  if (up10 === null || n10 === null || up5 === null || n5 === null) return null;
  const candles = Array.isArray(raw.candles)
    ? raw.candles.map(parseCandle).filter((c): c is YutaiCandle => c !== null)
    : [];
  return {
    code,
    name,
    minInvest: num(raw.minInvest),
    rightsMonths: Array.isArray(raw.rightsMonths)
      ? raw.rightsMonths.filter((m): m is number => typeof m === "number" && Number.isFinite(m))
      : [],
    detailUrl: typeof detailUrl === "string" ? detailUrl : "",
    candles,
    up10,
    n10,
    up5,
    n5,
    avgRet10: num(raw.avgRet10),
    avgHighRet10: num(raw.avgHighRet10),
    price: num(raw.price),
    high12: num(raw.high12),
    low12: num(raw.low12),
    ma25: num(raw.ma25),
    ma75: num(raw.ma75),
    low1m: num(raw.low1m),
    ret1m: num(raw.ret1m),
    priceAsOf: typeof raw.priceAsOf === "string" && ISO_DATE.test(raw.priceAsOf) ? raw.priceAsOf : null,
    rights: parseRights(raw.rights),
    sector: str(raw.sector),
    yutaiStatus: (["active", "changed", "abolished"] as const).includes(raw.yutaiStatus as YutaiStatus)
      ? (raw.yutaiStatus as YutaiStatus)
      : "active",
    yutaiNote: str(raw.yutaiNote),
    yutaiSince: num(raw.yutaiSince),
    nextEarningsDate: isoDate(raw.nextEarningsDate),
    earningsSource: raw.earningsSource === "jpx" || raw.earningsSource === "yahoo" ? raw.earningsSource : null,
    profitTrend: raw.profitTrend === "up" || raw.profitTrend === "down" ? raw.profitTrend : null,
    profitAsOf: isoDate(raw.profitAsOf),
    profitChange: num(raw.profitChange),
    profitBasis:
      raw.profitBasis === "operating" || raw.profitBasis === "net" || raw.profitBasis === "eps" ? raw.profitBasis : null,
  };
}

function parseBaselineYear(raw: unknown): YutaiBaselineYear | null {
  if (!isRecord(raw)) return null;
  const year = num(raw.year);
  const n = num(raw.n);
  if (year === null || n === null || n < 0) return null;
  return {
    year: Math.round(year),
    n: Math.round(n),
    winRate: num(raw.winRate),
    avgRet: num(raw.avgRet),
    avgHighRet: num(raw.avgHighRet),
  };
}

function parseRightsBaselineYear(raw: unknown): YutaiRightsBaselineYear | null {
  if (!isRecord(raw)) return null;
  const year = num(raw.year);
  const n = num(raw.n);
  if (year === null || n === null || n < 0) return null;
  return {
    year: Math.round(year),
    n: Math.round(n),
    winRate: num(raw.winRate),
    avgRet: num(raw.avgRet),
    hit10Rate: num(raw.hit10Rate),
  };
}

function parseRightsBaseline(raw: unknown): YutaiRightsBaseline | null {
  if (!isRecord(raw)) return null;
  const n = num(raw.n);
  if (n === null || n <= 0) return null;
  return {
    n: Math.round(n),
    winRate10: num(raw.winRate10),
    avgRet10: num(raw.avgRet10),
    hit10Rate10: num(raw.hit10Rate10),
    avgHighRet10: num(raw.avgHighRet10),
    winRateAbove: num(raw.winRateAbove),
    winRateBelow: num(raw.winRateBelow),
    avgDraw: num(raw.avgDraw),
    years: Array.isArray(raw.years)
      ? raw.years.map(parseRightsBaselineYear).filter((y): y is YutaiRightsBaselineYear => y !== null)
      : [],
  };
}

/** 月のベースライン（地合い）。無い・形が崩れていれば null（古いファイルには無い）。 */
function parseBaseline(raw: unknown): YutaiBaseline | null {
  if (!isRecord(raw)) return null;
  const n = num(raw.n);
  if (n === null || n < 0) return null;
  return {
    n: Math.round(n),
    winRate10: num(raw.winRate10),
    avgRet10: num(raw.avgRet10),
    avgHighRet10: num(raw.avgHighRet10),
    years: Array.isArray(raw.years)
      ? raw.years.map(parseBaselineYear).filter((y): y is YutaiBaselineYear => y !== null)
      : [],
    rights: parseRightsBaseline(raw.rights),
  };
}

function parseBasketStat(raw: unknown): YutaiBasketStat | null {
  if (!isRecord(raw)) return null;
  const topN = num(raw.topN);
  if (topN === null || topN < 1 || !Array.isArray(raw.years)) return null;
  const years = raw.years.flatMap((r): YutaiBasketYear[] => {
    if (!isRecord(r)) return [];
    const year = num(r.year);
    const n = num(r.n);
    if (year === null || n === null) return [];
    return [
      {
        year: Math.round(year),
        ret: num(r.ret),
        n: Math.round(n),
        codes: Array.isArray(r.codes) ? r.codes.filter((c): c is string => typeof c === "string") : [],
      },
    ];
  });
  const pickYear = (v: unknown): { year: number; ret: number } | null => {
    if (!isRecord(v)) return null;
    const year = num(v.year);
    const ret = num(v.ret);
    return year === null || ret === null ? null : { year: Math.round(year), ret };
  };
  return {
    topN: Math.round(topN),
    years,
    n: Math.round(num(raw.n) ?? 0),
    wins: Math.round(num(raw.wins) ?? 0),
    avgRet: num(raw.avgRet),
    maxDrawdown: num(raw.maxDrawdown),
    best: pickYear(raw.best),
    worst: pickYear(raw.worst),
  };
}

/** バスケット成績。無い・形が崩れていれば null（古いファイルには無い）。 */
function parseBasket(raw: unknown): YutaiBasketResult | null {
  if (!isRecord(raw) || !isRecord(raw.byTopN)) return null;
  const byTopN: Record<string, YutaiBasketStat> = {};
  for (const [k, v] of Object.entries(raw.byTopN)) {
    const s = parseBasketStat(v);
    if (s) byTopN[k] = s;
  }
  return Object.keys(byTopN).length > 0 ? { byTopN } : null;
}

function parseMonth(raw: unknown, key: string): YutaiMonth | null {
  if (!isRecord(raw)) return null;
  const month = num(raw.month) ?? Number(key);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(parseItem).filter((x): x is YutaiItem => x !== null)
    : [];
  const listed = num(raw.listedCount);
  const prev = num(raw.prevMonth);
  return {
    month,
    prevMonth: prev !== null ? Math.round(prev) : month === 1 ? 12 : month - 1,
    listUrl: typeof raw.listUrl === "string" ? raw.listUrl : "",
    listedCount: listed !== null && listed >= 0 ? Math.round(listed) : items.length,
    items,
    baseline: parseBaseline(raw.baseline),
    basket: parseBasket(raw.basket),
  };
}

/**
 * 月別ファイル public/data/yutai/<M>.json（unknown）を検証して型付きにする。
 * 月が 1〜12 でない・asOf が日付でなければ null。形の崩れた銘柄・月足は落とす。items が空でも返す。
 */
export function parseYutaiMonthFile(raw: unknown): YutaiMonthFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const month = parseMonth(raw, String(raw.month));
  if (!month) return null;
  return { ...month, asOf, generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "" };
}

/** asOf が todayIso から staleDays 日以上前か（日付が崩れていれば古い扱い）。 */
export function isYutaiStale(asOf: string, todayIso: string, staleDays = YUTAI_STALE_DAYS): boolean {
  if (!ISO_DATE.test(asOf) || !ISO_DATE.test(todayIso)) return true;
  return daysBetween(asOf, todayIso) >= staleDays;
}

/** 既定の権利確定月 ＝ 今月＋1（講師の型: 権利確定月の前月＝今月に買い、権利付最終日までに売る）。12 を超えたら 1 から数え直す。 */
export function defaultYutaiMonth(todayIso: string): number {
  const m = Number(todayIso.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) return 1;
  return (m % 12) + 1;
}

/** 月の表示（12 → "12月"）。 */
export function monthLabel(m: number): string {
  return `${m}月`;
}
