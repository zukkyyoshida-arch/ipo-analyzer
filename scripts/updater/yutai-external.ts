import type { YutaiDailyIndicators, YutaiItem, YutaiMonth } from "../../src/lib/yutai/types";
import type { YutaiDetail } from "./yutai-detail";
import type { ProfitTrend } from "./yutai-yahoo";

// 優待の外部ソース（詳細ページ・決算発表予定日・直近決算）を月別データに載せ、除外ルールを当てる。純関数。
// 通信は yutai-detail.ts / yutai-earnings.ts / yutai-yahoo.ts、呼び出しは yutai-main.ts と yutai-refresh-main.ts。

export interface EarningsInfo {
  date: string;
  source: "jpx" | "yahoo";
}

export interface ExternalData {
  detail?: Map<string, YutaiDetail>;
  earnings?: Map<string, EarningsInfo>;
  profit?: Map<string, ProfitTrend>;
}

/** 外部ソースの値を item に載せる（取れなかった項目は触らない＝前回の値が残る。null は書かない）。 */
export function attachExternal(item: YutaiItem, ext: ExternalData): YutaiItem {
  const out: YutaiItem = { ...item };
  const d = ext.detail?.get(item.code);
  if (d) {
    if (d.sector) out.sector = d.sector;
    out.yutaiStatus = d.status;
    if (d.note) out.yutaiNote = d.note;
    else delete out.yutaiNote;
    if (d.since !== null) out.yutaiSince = d.since;
  }
  const e = ext.earnings?.get(item.code);
  if (e) {
    out.nextEarningsDate = e.date;
    out.earningsSource = e.source;
  }
  const p = ext.profit?.get(item.code);
  if (p && p.profitAsOf) {
    out.profitTrend = p.profitTrend;
    out.profitAsOf = p.profitAsOf;
    out.profitChange = p.profitChange;
    out.profitBasis = p.profitBasis;
  }
  return out;
}

/**
 * 月別データに外部ソースの値（業種・優待の状態・決算発表予定日・直近決算）を載せる。items は削除しない。
 * 廃止・決算またぎの除外は画面側の純関数（src/lib/yutai/exclude.ts）で行う。
 */
export function applyExternal<M extends YutaiMonth>(month: M, ext: ExternalData): M {
  return { ...month, items: month.items.map((it) => attachExternal(it, ext)) };
}

/** 日足から作った現在値まわりの指標を item に上書きする（日足が足りない高安は月足の値のまま）。 */
export function applyIndicators(item: YutaiItem, ind: YutaiDailyIndicators): YutaiItem {
  return {
    ...item,
    price: ind.price ?? item.price,
    high12: ind.high12 ?? item.high12,
    low12: ind.low12 ?? item.low12,
    ma25: ind.ma25,
    ma75: ind.ma75,
    low1m: ind.low1m,
    ret1m: ind.ret1m,
    priceAsOf: ind.priceAsOf,
  };
}

/** 今月＋1・今月＋2 の権利月（1〜12）。決算発表予定日・直近決算・日次更新の対象。 */
export function targetMonths(todayIso: string): number[] {
  const m = Number(todayIso.slice(5, 7));
  return [(m % 12) + 1, ((m + 1) % 12) + 1];
}
