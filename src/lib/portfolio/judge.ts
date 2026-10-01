// 保有の状態判定（機械的なルール。固定）と合計。純関数。
// - 逆指値引き上げ条件 = 買値 × 1.08 → 到達したら逆指値を 買値 × 1.05 に上げる
// - 利確目安           = 買値 × 1.10 → 到達したら利確
// 現在値は「取得した値・手入力・優待の月足終値」のうち日付の新しいものを使う。

import { nextYutaiSchedule } from "../calendar/yutaiDates";
import { daysBetween } from "../date";
import { isOpen, type Holding, type PriceCache, type PriceQuote } from "./types";

/** 利確目安の倍率。 */
export const TAKE_PROFIT_RATIO = 1.1;
/** 逆指値を引き上げる条件の倍率。 */
export const TRAIL_TRIGGER_RATIO = 1.08;
/** 引き上げ後の逆指値の倍率。 */
export const TRAIL_STOP_RATIO = 1.05;

/** 浮動小数の誤差（1000 × 1.08 = 1080.0000000000001 など）を吸収する幅。 */
const EPS = 1e-9;

/** 状態。unknown は現在値が無いとき。 */
export type HoldingStatusKind = "unknown" | "watch" | "trail" | "takeProfit";

export interface HoldingStatus {
  kind: HoldingStatusKind;
  /** 買値からの騰落率（%）。現在値が無ければ null */
  pct: number | null;
  /** 利確目安の株価 */
  targetPrice: number;
  /** 逆指値を引き上げる株価 */
  triggerPrice: number;
  /** 引き上げ後の逆指値 */
  stopPrice: number;
}

/** 円の表示用に丸める（1 円未満は切り上げ。逆指値・利確の指値は呼値に合わせて本人が微調整する）。 */
function ceilYen(v: number): number {
  return Math.ceil(v - EPS);
}

/** 買値と現在値から状態を決める。 */
export function holdingStatus(buyPrice: number, current: number | null): HoldingStatus {
  const base = {
    targetPrice: ceilYen(buyPrice * TAKE_PROFIT_RATIO),
    triggerPrice: ceilYen(buyPrice * TRAIL_TRIGGER_RATIO),
    stopPrice: ceilYen(buyPrice * TRAIL_STOP_RATIO),
  };
  if (current === null || !(buyPrice > 0)) return { kind: "unknown", pct: null, ...base };
  const ratio = current / buyPrice;
  const pct = (ratio - 1) * 100;
  const kind: HoldingStatusKind =
    ratio >= TAKE_PROFIT_RATIO - EPS ? "takeProfit" : ratio >= TRAIL_TRIGGER_RATIO - EPS ? "trail" : "watch";
  return { kind, pct, ...base };
}

/** 手入力の値とキャッシュ（取得・月足）のうち、日付の新しい値。同じ日なら 取得 > 手入力 > 月足。 */
export function pickPrice(holding: Holding, cache: PriceCache): PriceQuote | null {
  const candidates: PriceQuote[] = [];
  const cached = cache[holding.code];
  if (cached) candidates.push(cached);
  if (holding.manualPrice) {
    candidates.push({ price: holding.manualPrice.price, asOf: holding.manualPrice.date, source: "manual" });
  }
  const rank = { live: 0, manual: 1, yutai: 2 } as const;
  candidates.sort((a, b) => (a.asOf !== b.asOf ? b.asOf.localeCompare(a.asOf) : rank[a.source] - rank[b.source]));
  return candidates[0] ?? null;
}

/**
 * 取得した値をキャッシュへ入れる。既にある値より日付が古ければ入れない
 * （月足終値で、新しく取得した値を上書きしないため）。
 */
export function mergePrice(cache: PriceCache, code: string, quote: PriceQuote): PriceCache {
  const prev = cache[code];
  if (prev && prev.asOf > quote.asOf) return cache;
  if (prev && prev.asOf === quote.asOf && prev.source === "live" && quote.source !== "live") return cache;
  return { ...cache, [code]: quote };
}

export interface PortfolioSummary {
  /** 保有中の件数 */
  openCount: number;
  /** 投資額（買値 × 株数の合計） */
  invested: number;
  /** 評価額（現在値 × 株数。現在値が無い銘柄は買値で数える） */
  value: number;
  /** 評価損益 */
  pnl: number;
  /** 評価損益率（%）。投資額 0 なら null */
  pnlPct: number | null;
  /** 現在値が無く買値で数えた件数 */
  unpricedCount: number;
  /** 売却済みの確定損益の合計 */
  realizedPnl: number;
}

/** 保有中の合計（投資額・評価額・損益）と、売却済みの確定損益。 */
export function summarize(holdings: Holding[], cache: PriceCache): PortfolioSummary {
  let invested = 0;
  let value = 0;
  let unpricedCount = 0;
  let openCount = 0;
  let realizedPnl = 0;
  for (const h of holdings) {
    if (!isOpen(h)) {
      realizedPnl += realizedPnlOf(h) ?? 0;
      continue;
    }
    openCount++;
    const cost = h.buyPrice * h.shares;
    invested += cost;
    const q = pickPrice(h, cache);
    if (q) value += q.price * h.shares;
    else {
      value += cost;
      unpricedCount++;
    }
  }
  const pnl = value - invested;
  return {
    openCount,
    invested,
    value,
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
    unpricedCount,
    realizedPnl,
  };
}

/** 売却済みの確定損益（円）。保有中なら null。 */
export function realizedPnlOf(h: Holding): number | null {
  return h.sold ? (h.sold.price - h.buyPrice) * h.shares : null;
}

/** +8% か +10% に届いている保有中の件数（ホームのタブのバッジに使う）。 */
export function countReached(holdings: Holding[], cache: PriceCache): number {
  return holdings.filter((h) => {
    if (!isOpen(h)) return false;
    const q = pickPrice(h, cache);
    const kind = holdingStatus(h.buyPrice, q?.price ?? null).kind;
    return kind === "trail" || kind === "takeProfit";
  }).length;
}

/** 優待の保有なら、次の権利付最終日とそこまでの日数。優待でなければ null。 */
export function lastCumInfo(h: Holding, todayIso: string): { date: string; days: number } | null {
  if (h.strategy !== "yutai" || h.rightsMonth === null) return null;
  const date = nextYutaiSchedule(h.rightsMonth, todayIso).lastCumDate;
  return { date, days: daysBetween(todayIso, date) };
}
