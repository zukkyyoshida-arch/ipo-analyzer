import type { YutaiDailyIndicators, YutaiExcludedItem, YutaiItem, YutaiMonth } from "../../src/lib/yutai/types";
import { nextYutaiSchedule } from "../../src/lib/calendar/yutaiDates";
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

/** 権利確定月 month の次の売買期間（買い開始日〜権利付最終日）。todayIso 基準。 */
export function earningsWindow(month: number, todayIso: string): { from: string; to: string } {
  const s = nextYutaiSchedule(month, todayIso);
  return { from: s.buyStart, to: s.lastCumDate };
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
 * 月別データに外部ソースを載せ、除外ルールを当てる。
 * - 優待廃止（yutaiStatus = abolished）→ items から除外
 * - nextEarningsDate が [買い開始日, 権利付最終日] に入る → items から除外
 * 除外は excludedItems に積み（前回までの除外も引き継ぐ）、件数は excludedItems から数え直す。
 * 決算日は todayIso 以降のものだけを見る（過去の日付は無視）。
 */
export function applyExternal<M extends YutaiMonth>(month: M, ext: ExternalData, todayIso: string): M {
  const win = earningsWindow(month.month, todayIso);
  const excluded: YutaiExcludedItem[] = [...(month.excludedItems ?? [])];
  const known = new Set(excluded.map((x) => x.code));
  const items: YutaiItem[] = [];
  for (const raw of month.items) {
    const it = attachExternal(raw, ext);
    if (it.yutaiStatus === "abolished") {
      if (!known.has(it.code)) excluded.push({ code: it.code, name: it.name, reason: "abolished" });
      continue;
    }
    const ed = it.nextEarningsDate;
    if (ed && ed >= todayIso && ed >= win.from && ed <= win.to) {
      if (!known.has(it.code)) excluded.push({ code: it.code, name: it.name, reason: "earnings", earningsDate: ed });
      continue;
    }
    items.push(it);
  }
  // 前回除外した銘柄が、今回の一覧にそもそも載らなくなっていても記録は残す（画面の「N件除外」は直近の結果）
  return {
    ...month,
    items,
    excludedItems: excluded,
    excludedAbolished: excluded.filter((x) => x.reason === "abolished").length,
    excludedEarnings: excluded.filter((x) => x.reason === "earnings").length,
  };
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
