// 優待の先回り買いの「指値エントリーの候補」。純関数。
// 成行（いまの株価）のほかに、過去の下押し幅（買い開始日〜権利付最終日の最安値）から押し目の指値、
// 75 日線・直近 1 か月の安値を候補にする。株数・利確・逆指値は entry.ts の yutaiEntryPlan をその価格で呼ぶ。
// 価格は東証の呼値の刻みに切り下げる（TOPIX500 採用銘柄はさらに細かい刻みだが、粗い刻みの値はその倍数なので発注できる値になる）。
// fillRate は「過去にその指値まで下がった年の割合」（約定しやすさの目安。将来を示すものではない）。

import type { YutaiItem } from "./types";
import { yutaiEntryPlan } from "./entry";
import { floorTick } from "../secondary/priceLimits";

/** drawHits の並び（[−2%, −3%, −5%, −8%] の到達年数）に対応する下押し幅。 */
export const DRAW_LEVELS = [0.02, 0.03, 0.05, 0.08] as const;

export type LimitOrderId = "market" | "dip" | "ma75" | "low1m" | "custom";

export interface LimitOrderPlan {
  id: LimitOrderId;
  label: string;
  /** 指値（円・呼値の刻みに丸め済み） */
  price: number;
  /** 株数（100 株単位）。資金が未指定なら null、枠で買えなければ 0 */
  shares: number | null;
  /** エントリー金額（円）= 株数 × 指値。資金が未指定なら null */
  amountYen: number | null;
  takeProfitPrice: number;
  trailTriggerPrice: number;
  trailStopPrice: number;
  /** 過去にその指値まで下がった年の割合（0〜1）。成行は 1、判定できなければ null */
  fillRate: number | null;
}

/**
 * 指値 limitPrice に対する、過去に届いた年の割合。
 * 現在値からの下押し幅に一番近い（それ以上深い）ライン（−2/−3/−5/−8%）の到達率を使う。8% より深いと null。
 */
export function fillRateOf(
  currentPrice: number,
  limitPrice: number,
  rights: Pick<NonNullable<YutaiItem["rights"]>, "n10" | "drawHits"> | null | undefined,
): number | null {
  if (!rights || !rights.drawHits || rights.drawHits.length < DRAW_LEVELS.length || rights.n10 <= 0) return null;
  if (!(currentPrice > 0) || !(limitPrice > 0)) return null;
  if (limitPrice >= currentPrice) return 1;
  const depth = 1 - limitPrice / currentPrice;
  const i = DRAW_LEVELS.findIndex((l) => l >= depth - 1e-9);
  if (i < 0) return null;
  return Math.min(1, rights.drawHits[i] / rights.n10);
}

/** 1 つの指値ぶんの計画（自由入力の指値にも使う）。 */
export function limitOrderPlan(
  item: Pick<YutaiItem, "price" | "rights">,
  id: LimitOrderId,
  label: string,
  rawPrice: number,
  budgetYen: number | null,
  splitCount: number,
): LimitOrderPlan | null {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  const price = floorTick(rawPrice);
  if (price <= 0) return null;
  const hasBudget = budgetYen !== null && budgetYen > 0;
  const e = yutaiEntryPlan(price, hasBudget ? budgetYen : 1, splitCount);
  if (!e) return null;
  return {
    id,
    label,
    price,
    shares: hasBudget ? e.shares : null,
    amountYen: hasBudget ? e.amountYen : null,
    takeProfitPrice: floorTick(e.takeProfitPrice),
    trailTriggerPrice: floorTick(e.trailTriggerPrice),
    trailStopPrice: floorTick(e.trailStopPrice),
    fillRate: id === "market" ? 1 : item.price === null ? null : fillRateOf(item.price, price, item.rights),
  };
}

/**
 * 指値の候補（成行・押し目・75 日線・直近安値の順）。株価が無ければ空。
 * 75 日線・直近安値は株価より下にあるときだけ。押し目は avgDraw10（0 以下の比率）が取れたときだけ。
 */
export function limitOrderPlans(
  item: Pick<YutaiItem, "price" | "rights" | "ma75" | "low1m">,
  stats: { years: { year: number; ret: number }[] },
  budgetYen: number | null,
  splitCount: number,
): LimitOrderPlan[] {
  void stats;
  const p = item.price;
  if (p === null || !Number.isFinite(p) || p <= 0) return [];
  const out: (LimitOrderPlan | null)[] = [limitOrderPlan(item, "market", "成行の目安", p, budgetYen, splitCount)];
  const draw = item.rights?.avgDraw10;
  if (draw !== null && draw !== undefined && Number.isFinite(draw) && draw <= 0) {
    out.push(limitOrderPlan(item, "dip", "押し目の指値（平均の下押し）", p * (1 + draw), budgetYen, splitCount));
  }
  if (item.ma75 != null && item.ma75 > 0 && item.ma75 < p) {
    out.push(limitOrderPlan(item, "ma75", "75日線の指値", item.ma75, budgetYen, splitCount));
  }
  if (item.low1m != null && item.low1m > 0 && item.low1m < p) {
    out.push(limitOrderPlan(item, "low1m", "直近安値の指値（1か月）", item.low1m, budgetYen, splitCount));
  }
  return out.filter((x): x is LimitOrderPlan => x !== null);
}

/** 期待利益と最悪ケース（円）。過去 10 年の平均騰落・一番悪かった年の騰落 × エントリー金額。年が無ければ null。 */
export function expectedOutcome(
  stats: { years: { year: number; ret: number }[]; avgRet10: number | null },
  amountYen: number,
): { avgYen: number | null; worstYen: number | null; worstYear: number | null } {
  if (!(amountYen > 0)) return { avgYen: null, worstYen: null, worstYear: null };
  const avgYen = stats.avgRet10 === null ? null : Math.round(stats.avgRet10 * amountYen);
  if (stats.years.length === 0) return { avgYen, worstYen: null, worstYear: null };
  const worst = stats.years.reduce((a, b) => (b.ret < a.ret ? b : a));
  return { avgYen, worstYen: Math.round(worst.ret * amountYen), worstYear: worst.year };
}
