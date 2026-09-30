// セカンダリーの線（ストップ高・利確線・初値・損切り線・ストップ安）と基準値段の決め方（純関数）。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。
//
// 単位: 初値は上場時の単位、株価（/api/quote）は現在の単位（src/lib/price.ts）。
// 利確線・損切り線はバックテストと同じく「上場時の単位の初値」で計算し、表示用に現在の単位へ換算する。
// その日のストップ高・ストップ安は現在の単位の基準値段で計算する（実際に売買される値段の刻み）。

import { roundPrice } from "@/lib/price";
import { lineAbove, lineBelow, stopHigh, stopLow } from "./priceLimits";
import type { SecondaryProfile } from "./profiles";

export type BaseSource = "listingDay" | "prevClose" | "lastClose" | "initialFallback";

export interface BasePrice {
  /** 基準値段（現在の単位） */
  price: number;
  source: BaseSource;
  /** 表示用の説明 */
  label: string;
}

export interface QuoteLike {
  price: number;
  prevClose: number | null;
  closes: { date: string }[];
}

function formatMd(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

/**
 * 基準値段を決める。
 * - 上場初日（今日 = 上場日）: 初値
 * - 株価の最新の日足が今日: 前日終値（本日の基準値段）
 * - 最新の日足が今日より前: その日の終値（取引時間中で当日の日足がまだ無い・休日・場が開く前）
 * - 株価が取れない: 初値（初日基準）
 * @param initialCurrent 初値（現在の単位）
 */
export function resolveBasePrice(args: {
  todayIso: string;
  listingDate: string;
  initialCurrent: number;
  quote: QuoteLike | null;
}): BasePrice {
  const { todayIso, listingDate, initialCurrent, quote } = args;
  if (listingDate !== "" && todayIso === listingDate) {
    return { price: initialCurrent, source: "listingDay", label: "上場初日の基準値段（初値）" };
  }
  const lastDate = quote?.closes[quote.closes.length - 1]?.date;
  if (quote && lastDate) {
    if (lastDate === todayIso) {
      if (typeof quote.prevClose === "number" && quote.prevClose > 0) {
        return { price: quote.prevClose, source: "prevClose", label: "本日の基準値段（前日終値）" };
      }
    } else if (lastDate < todayIso && quote.price > 0) {
      return {
        price: quote.price,
        source: "lastClose",
        label: `基準値段（${formatMd(lastDate)}の終値）`,
      };
    }
  }
  return { price: initialCurrent, source: "initialFallback", label: "基準値段（初日基準＝初値）" };
}

export type LineKind = "stopHigh" | "takeProfit" | "initial" | "stopLoss" | "stopLow";

export interface SecondaryLine {
  kind: LineKind;
  label: string;
  /** 価格（現在の単位） */
  price: number;
}

/**
 * 線の一覧（価格の高い順）。
 * @param initialListing 初値（上場時の単位）
 * @param factor 累積分割係数（現在の単位 = 上場時の単位 ÷ 係数）
 * @param base 基準値段（現在の単位）
 */
export function buildSecondaryLines(args: {
  initialListing: number;
  factor: number;
  base: number;
  profile: SecondaryProfile;
}): SecondaryLine[] {
  const { initialListing, factor, base, profile } = args;
  const toCurrent = (p: number) => (factor === 1 ? p : roundPrice(p / factor));
  const tpLabel =
    profile.takeProfitPctOfWidth === 100
      ? "利確線（初日のストップ高）"
      : `利確線（初値＋初日の値幅×${profile.takeProfitPctOfWidth}%）`;
  const lines: SecondaryLine[] = [
    { kind: "stopHigh", label: "ストップ高", price: stopHigh(base) },
    {
      kind: "takeProfit",
      label: tpLabel,
      price: toCurrent(lineAbove(initialListing, profile.takeProfitPctOfWidth)),
    },
    { kind: "initial", label: "初値（買値の想定）", price: toCurrent(initialListing) },
    {
      kind: "stopLoss",
      label: `損切り線（初値−${profile.stopLossPct}%）`,
      price: toCurrent(lineBelow(initialListing, profile.stopLossPct)),
    },
    { kind: "stopLow", label: "ストップ安", price: stopLow(base) },
  ];
  // 同値のときは表の順（ストップ高 → … → ストップ安）を保つ。
  return lines
    .map((line, i) => ({ line, i }))
    .sort((a, b) => b.line.price - a.line.price || a.i - b.i)
    .map(({ line }) => line);
}

/** 短い名前（位置の説明用）。 */
const SHORT: Record<LineKind, string> = {
  stopHigh: "ストップ高",
  takeProfit: "利確線",
  initial: "初値",
  stopLoss: "損切り線",
  stopLow: "ストップ安",
};

/** 現在値がどの線の間にいるかの1行。 */
export function describePosition(current: number, lines: SecondaryLine[]): string {
  const sorted = [...lines].sort((a, b) => b.price - a.price);
  const same = sorted.find((l) => Math.abs(l.price - current) < 1e-9);
  if (same) return `${SHORT[same.kind]}と同じ値です`;
  if (current > sorted[0].price) return `${SHORT[sorted[0].kind]}より上です`;
  const last = sorted[sorted.length - 1];
  if (current < last.price) return `${SHORT[last.kind]}より下です`;
  for (let i = 0; i < sorted.length - 1; i++) {
    const upper = sorted[i];
    const lower = sorted[i + 1];
    if (current < upper.price && current > lower.price) {
      return `${SHORT[lower.kind]}と${SHORT[upper.kind]}の間です`;
    }
  }
  return "";
}
