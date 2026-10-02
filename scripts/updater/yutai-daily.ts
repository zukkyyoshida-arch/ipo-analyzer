import { addBusinessDays, lastBusinessDayOfMonth } from "../../src/lib/calendar/businessDays";
import { yutaiSchedule } from "../../src/lib/calendar/yutaiDates";
import type {
  YutaiDailyIndicators,
  YutaiItem,
  YutaiRights,
  YutaiRightsBaseline,
  YutaiRightsBaselineYear,
  YutaiRightsYear,
} from "../../src/lib/yutai/types";
import { prevMonthOf } from "../../src/lib/yutai/types";
import { HIGH_ZONE, LOW_ZONE } from "../../src/lib/picks/yutai";
import {
  adjustQuotes,
  jstDateIso,
  jstParts,
  YUTAI_RECENT_YEARS,
  YUTAI_YEARS,
  yutaiYearRange,
  type RawMonthlyQuote,
} from "./yutai";

// 優待の「前月初に買い、権利付最終日に売る」を日足で集計する純関数群。
// 通信・キャッシュは yutai-daily-fetch.ts、組み込みは yutai-main.ts。
//
// - 買値 = 前月の最初の営業日の始値（src/lib/calendar/yutaiDates.ts の buyStart）
// - 売値 = 権利付最終日の終値（同 lastCumDate。2019 年 7 月より前は受渡しが T+3 だったので 3 営業日前）
// - ret = 売値 / 買値 − 1、maxHighRet = 期間中の日中高値の最大 / 買値 − 1、hit10 = maxHighRet ≥ +10%
// - 株価は月足と同じ adjustQuotes で補正する（adjclose/close の比率で配当・反映済みの分割を補正し、
//   Yahoo がまだ反映していない分割・併合は前日終値 → 当日始値の段差で検出して古い側を補正する）

/** +10% 到達の判定ライン。 */
export const YUTAI_HIT_LINE = 0.1;
/** 買い開始日・権利付最終日にその銘柄の足が無いとき（売買停止・上場前後など）、前後に探す営業日数。 */
const SEARCH_BUSINESS_DAYS = 3;
/** 株価位置に使う遡り営業日数（約 12 か月）と、位置・高安を出すのに必要な最低本数。 */
export const POS_LOOKBACK = 250;
export const POS_MIN_BARS = 120;
/** 移動平均の営業日数。 */
export const MA_LONG = 75;
export const MA_SHORT = 25;
/** 1 か月ぶんの営業日数（安値・急騰判定の遡り）。 */
export const MONTH_BARS = 21;
/** 下押し幅の判定ライン（−2% / −3% / −5% / −8%）。 */
export const DRAW_LINES = [0.02, 0.03, 0.05, 0.08] as const;

/** 日足 1 本（JST の日付つき・補正後）。 */
export interface DailyBar {
  /** YYYY-MM-DD（JST） */
  date: string;
  open: number;
  high: number | null;
  low: number | null;
  close: number;
}

/**
 * Yahoo の日足 quotes を補正して JST の日付ごとの足にする（古い→新しい）。
 * 日足の date は「当日 00:00Z」（= JST 9:00）。当日のライブ値が別の行で付くことがあるので、
 * 同じ日付の行は始値=最初・終値=最後・高安=最大/最小でまとめる。
 */
export function toDailyBars(quotes: RawMonthlyQuote[]): DailyBar[] {
  const out: DailyBar[] = [];
  for (const { t, open, high, low, close } of adjustQuotes(quotes)) {
    const date = jstDateIso(t);
    const last = out[out.length - 1];
    if (last && last.date === date) {
      last.close = close;
      if (high !== null) last.high = last.high === null ? high : Math.max(last.high, high);
      if (low !== null) last.low = last.low === null ? low : Math.min(last.low, low);
      continue;
    }
    out.push({ date, open, high, low, close });
  }
  return out;
}

/**
 * 過去の権利付最終日。受渡しは 2019-07-16 約定分から T+2（それより前は T+3）。
 * 2019 年 7 月以降の権利確定月は yutaiSchedule と同じ「最終営業日の 2 営業日前」、それより前は 3 営業日前。
 */
export function historicalLastCumDate(year: number, month: number): string {
  if (year > 2019 || (year === 2019 && month >= 7)) return yutaiSchedule(year, month).lastCumDate;
  return addBusinessDays(lastBusinessDayOfMonth(year, month), -3);
}

/**
 * 権利確定月 rightsMonth の、前月の年 prevYear の売買期間。
 * 例: 3 月権利・prevYear 2025 → 2025-02 の最初の営業日〜2025-03 の権利付最終日。
 * 1 月権利・prevYear 2025 → 2025-12 の最初の営業日〜2026-01 の権利付最終日。
 */
export function rightsWindow(rightsMonth: number, prevYear: number): { buy: string; sell: string } {
  const rightsYear = rightsMonth === 1 ? prevYear + 1 : prevYear;
  return {
    buy: yutaiSchedule(rightsYear, rightsMonth).buyStart,
    sell: historicalLastCumDate(rightsYear, rightsMonth),
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** bars（日付の昇順）で date 以上の最初の位置。 */
function lowerBound(bars: DailyBar[], date: string): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 1 年ぶんの成績。買い開始日（無ければ 3 営業日後まで）の始値で買い、権利付最終日（無ければ 3 営業日前まで）の終値で売る。
 * どちらかの足が無い・買値が 0 以下・売りが買いより前なら null（上場前・売買停止など）。
 */
export function rightsYearStat(bars: DailyBar[], rightsMonth: number, prevYear: number): YutaiRightsYear | null {
  const { buy, sell } = rightsWindow(rightsMonth, prevYear);
  const bi = lowerBound(bars, buy);
  const buyBar = bars[bi];
  if (!buyBar || buyBar.date > addBusinessDays(buy, SEARCH_BUSINESS_DAYS) || buyBar.open <= 0) return null;
  // 売り: sell 以下の最後の足
  const sj = lowerBound(bars, sell);
  const si = bars[sj]?.date === sell ? sj : sj - 1;
  const sellBar = bars[si];
  if (!sellBar || si < bi || sellBar.date < addBusinessDays(sell, -SEARCH_BUSINESS_DAYS)) return null;
  // 期間の後ろに足が続いていない（データの末尾が期間の途中）なら未完結とみなす
  if (si === bars.length - 1 && sellBar.date < sell) return null;
  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (let i = bi; i <= si; i++) {
    const b = bars[i];
    maxHigh = Math.max(maxHigh, b.high ?? Math.max(b.open, b.close));
    minLow = Math.min(minLow, b.low ?? Math.min(b.open, b.close));
  }
  const maxHighRet = maxHigh / buyBar.open - 1;
  return {
    year: prevYear,
    ret: round4(sellBar.close / buyBar.open - 1),
    hit10: maxHighRet >= YUTAI_HIT_LINE - 1e-9,
    maxHighRet: round4(maxHighRet),
    posAtBuy: positionBefore(bars, bi, buyBar.open),
    aboveMa75: aboveMaBefore(bars, bi, buyBar.open),
    maxDrawRet: round4(Math.min(0, minLow / buyBar.open - 1)),
  };
}

/** bars[idx] より前の直近 POS_LOOKBACK 本の高安レンジの中の price の位置（0〜1）。120 本未満・高安が同値なら null。 */
export function positionBefore(bars: DailyBar[], idx: number, price: number): number | null {
  const prior = bars.slice(Math.max(0, idx - POS_LOOKBACK), idx);
  if (prior.length < POS_MIN_BARS) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of prior) {
    hi = Math.max(hi, b.high ?? Math.max(b.open, b.close));
    lo = Math.min(lo, b.low ?? Math.min(b.open, b.close));
  }
  if (!(hi > lo)) return null;
  return round4(Math.min(1, Math.max(0, (price - lo) / (hi - lo))));
}

/** bars[idx] より前の直近 MA_LONG 本の終値の単純移動平均より price が上か。75 本未満なら null。 */
export function aboveMaBefore(bars: DailyBar[], idx: number, price: number): boolean | null {
  if (idx < MA_LONG) return null;
  const ma = bars.slice(idx - MA_LONG, idx).reduce((a, b) => a + b.close, 0) / MA_LONG;
  return price > ma;
}

function mean(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * 権利確定月 rightsMonth の直近 10 年（前月の年で数える。実行年を含まない暦年＝月足の candles と同じ範囲）の成績。
 * 1 年も取れなければ null。
 */
export function summarizeRights(bars: DailyBar[], rightsMonth: number, now: Date): YutaiRights | null {
  const r10 = yutaiYearRange(now, YUTAI_YEARS);
  const r5 = yutaiYearRange(now, YUTAI_RECENT_YEARS);
  const years: YutaiRightsYear[] = [];
  for (let y = r10.from; y <= r10.to; y++) {
    // 1 月権利の y 年は翌年 1 月に売る。実行日より後に終わる期間は数えない
    const { sell } = rightsWindow(rightsMonth, y);
    if (sell >= jstDateIso(now)) continue;
    const s = rightsYearStat(bars, rightsMonth, y);
    if (s) years.push(s);
  }
  if (years.length === 0) return null;
  const last5 = years.filter((y) => y.year >= r5.from);
  const draws = years.map((y) => y.maxDrawRet).filter((v): v is number => v !== null);
  const avgDraw = mean(draws);
  const zone = (ys: YutaiRightsYear[]) => ({ n: ys.length, win: ys.filter((y) => y.ret > 0).length });
  const high = zone(years.filter((y) => typeof y.posAtBuy === "number" && y.posAtBuy >= HIGH_ZONE));
  const low = zone(years.filter((y) => typeof y.posAtBuy === "number" && y.posAtBuy <= LOW_ZONE));
  const mid = zone(years.filter((y) => typeof y.posAtBuy === "number" && y.posAtBuy > LOW_ZONE && y.posAtBuy < HIGH_ZONE));
  const above = zone(years.filter((y) => y.aboveMa75 === true));
  const below = zone(years.filter((y) => y.aboveMa75 === false));
  const avgRet = mean(years.map((y) => y.ret));
  const avgHigh = mean(years.map((y) => y.maxHighRet));
  return {
    years,
    n10: years.length,
    win10: years.filter((y) => y.ret > 0).length,
    hit10: years.filter((y) => y.hit10).length,
    avgRet10: avgRet === null ? null : round4(avgRet),
    avgHighRet10: avgHigh === null ? null : round4(avgHigh),
    n5: last5.length,
    win5: last5.filter((y) => y.ret > 0).length,
    winHigh10: high.win,
    nHigh10: high.n,
    winLow10: low.win,
    nLow10: low.n,
    winMid10: mid.win,
    nMid10: mid.n,
    winAbove10: above.win,
    nAbove10: above.n,
    winBelow10: below.win,
    nBelow10: below.n,
    avgDraw10: avgDraw === null ? null : round4(avgDraw),
    drawHits: DRAW_LINES.map((x) => draws.filter((d) => d <= -x + 1e-9).length),
  };
}

/** 日足ベースの地合い。items の rights.years を、年ごとと 10 年全体でまとめる（銘柄×年を同じ重み）。 */
export function computeRightsBaseline(
  items: Pick<YutaiItem, "rights">[],
  now: Date,
): YutaiRightsBaseline | null {
  const { from, to } = yutaiYearRange(now, YUTAI_YEARS);
  const withRights = items.filter((it) => it.rights && it.rights.years.length > 0);
  if (withRights.length === 0) return null;
  const all = withRights.flatMap((it) => (it.rights as YutaiRights).years.filter((y) => y.year >= from && y.year <= to));
  const stat = (ys: YutaiRightsYear[]) => {
    const r = (v: number | null) => (v === null ? null : round4(v));
    return {
      n: ys.length,
      winRate: r(ys.length > 0 ? ys.filter((y) => y.ret > 0).length / ys.length : null),
      avgRet: r(mean(ys.map((y) => y.ret))),
      hit10Rate: r(ys.length > 0 ? ys.filter((y) => y.hit10).length / ys.length : null),
    };
  };
  const years: YutaiRightsBaselineYear[] = [];
  for (let y = from; y <= to; y++) years.push({ year: y, ...stat(all.filter((x) => x.year === y)) });
  const total = stat(all);
  const avgHigh = mean(all.map((y) => y.maxHighRet));
  const winShare = (ys: YutaiRightsYear[]) =>
    ys.length > 0 ? round4(ys.filter((y) => y.ret > 0).length / ys.length) : null;
  const avgDraw = mean(all.map((y) => y.maxDrawRet).filter((v): v is number => typeof v === "number"));
  return {
    winRateAbove: winShare(all.filter((y) => y.aboveMa75 === true)),
    winRateBelow: winShare(all.filter((y) => y.aboveMa75 === false)),
    avgDraw: avgDraw === null ? null : round4(avgDraw),
    n: withRights.length,
    winRate10: total.winRate,
    avgRet10: total.avgRet,
    hit10Rate10: total.hit10Rate,
    avgHighRet10: avgHigh === null ? null : round4(avgHigh),
    years,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 日足から現在値まわりの指標を作る。足が無ければ null。
 * - price/priceAsOf = 最新の足の終値と日付
 * - high12/low12 = 直近 POS_LOOKBACK 本の高安（POS_MIN_BARS 本未満なら null＝呼び出し側で月足にフォールバック）
 * - ma25/ma75 = 直近 25/75 本の終値の単純移動平均（足りなければ null）
 * - low1m = 直近 MONTH_BARS 本の安値、ret1m = 最新終値 / MONTH_BARS 本前の終値 − 1
 */
export function dailyIndicators(bars: DailyBar[]): YutaiDailyIndicators | null {
  const n = bars.length;
  if (n === 0) return null;
  const last = bars[n - 1];
  const hl = n >= POS_MIN_BARS ? bars.slice(-POS_LOOKBACK) : [];
  const hiOf = (b: DailyBar) => b.high ?? Math.max(b.open, b.close);
  const loOf = (b: DailyBar) => b.low ?? Math.min(b.open, b.close);
  const ma = (k: number) =>
    n >= k ? round1(bars.slice(-k).reduce((a, b) => a + b.close, 0) / k) : null;
  const prev = n > MONTH_BARS ? bars[n - 1 - MONTH_BARS] : null;
  return {
    price: round1(last.close),
    priceAsOf: last.date,
    high12: hl.length > 0 ? round1(Math.max(...hl.map(hiOf))) : null,
    low12: hl.length > 0 ? round1(Math.min(...hl.map(loOf))) : null,
    ma25: ma(MA_SHORT),
    ma75: ma(MA_LONG),
    low1m: n >= MONTH_BARS ? round1(Math.min(...bars.slice(-MONTH_BARS).map(loOf))) : null,
    ret1m: prev && prev.close > 0 ? round4(last.close / prev.close - 1) : null,
  };
}

/**
 * 日足のキャッシュ（scratch など、取得日の分からないもの）が実行日の前月まで揃っているか。
 * 最後の足の日付（JST）が前月の最終営業日以降なら揃っているとみなす。
 * （日足は過去の完結した期間にしか使わないので、最後の足が引け前の値でも集計は変わらない）
 */
export function dailyCoversPreviousMonth(quotes: RawMonthlyQuote[], now: Date): boolean {
  const times = quotes.map((q) => new Date(q.date).getTime()).filter((t) => Number.isFinite(t));
  if (times.length === 0) return false;
  const lastIso = jstDateIso(new Date(Math.max(...times)));
  const { year, month } = jstParts(now);
  const py = month === 1 ? year - 1 : year;
  const pm = prevMonthOf(month);
  return lastIso >= lastBusinessDayOfMonth(py, pm);
}
