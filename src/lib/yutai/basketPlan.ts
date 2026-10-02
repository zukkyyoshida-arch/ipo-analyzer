// 優待のバスケット（分散投資）の一括提案。純関数。
// 除外適用後の総合評価の上位から分散数ぶんを選び、枠で 100 株も買えない銘柄は飛ばして次点を入れる。
// 同じ業種が 3 銘柄以上なら注意を出し、同じ業種以外で次点の 1 銘柄を差し替え候補にする。

import type { YutaiPick } from "@/lib/picks/yutai";
import { yutaiEntryPlan } from "./entry";

/** 同じ業種がこの数以上で偏りの注意を出す。 */
export const BASKET_SECTOR_WARN = 3;

export const UNKNOWN_SECTOR = "業種不明";

export interface BasketEntry {
  pick: YutaiPick;
  code: string;
  name: string;
  /** 業種（不明は UNKNOWN_SECTOR） */
  sector: string;
  shares: number;
  amountYen: number;
  /** 10 年勝率（0〜1） */
  winRate: number;
}

export interface BasketWarning {
  sector: string;
  count: number;
  /** 差し替えで外す銘柄（その業種で一番順位が低いもの） */
  dropCode: string;
  /** 差し替え候補（同じ業種以外で次点）。無ければ null */
  alt: BasketEntry | null;
}

export interface BasketPlan {
  entries: BasketEntry[];
  totalYen: number;
  /** 資金に対する使用率（0〜1） */
  usageRate: number;
  /** 金額加重の 10 年勝率（0〜1）。銘柄が無ければ null */
  weightedWinRate: number | null;
  sectors: { sector: string; count: number }[];
  warnings: BasketWarning[];
  /** 分散数に届かなかった銘柄数 */
  shortfall: number;
  /** 差し替えを適用したか */
  replaced: boolean;
}

function entryOf(pick: YutaiPick, budgetYen: number, splitCount: number): BasketEntry | null {
  const plan = yutaiEntryPlan(pick.item.price, budgetYen, splitCount);
  if (!plan || plan.overFrame) return null;
  return {
    pick,
    code: pick.item.code,
    name: pick.item.name,
    sector: pick.item.sector?.trim() || UNKNOWN_SECTOR,
    shares: plan.shares,
    amountYen: plan.amountYen,
    winRate: pick.upRate10,
  };
}

function countSectors(entries: BasketEntry[]): { sector: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.sector, (m.get(e.sector) ?? 0) + 1);
  return [...m].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count);
}

/**
 * picks（総合評価の高い順に並んだ除外適用後の銘柄）から、分散数ぶんのバスケットを作る。
 * データ不足（score が null）・株価なし・枠で 100 株買えない銘柄は飛ばす。
 * replaceCode は差し替え候補として入れる銘柄コード。業種が偏っていれば、その業種で一番順位の低い銘柄と入れ替える。
 */
export function buildBasket(
  picks: YutaiPick[],
  { budgetYen, splitCount, replaceCode }: { budgetYen: number; splitCount: number; replaceCode?: string | null },
): BasketPlan {
  const candidates: BasketEntry[] = [];
  for (const p of picks) {
    if (p.score === null) continue;
    const e = entryOf(p, budgetYen, splitCount);
    if (e) candidates.push(e);
  }
  const rankOf = new Map(candidates.map((c, i) => [c.code, i]));
  let selected = candidates.slice(0, Math.max(0, splitCount));

  let replaced = false;
  if (replaceCode) {
    const incoming = candidates.find((c) => c.code === replaceCode);
    const heavy = countSectors(selected).find((s) => s.count >= BASKET_SECTOR_WARN && s.sector !== UNKNOWN_SECTOR);
    if (incoming && heavy && !selected.includes(incoming) && incoming.sector !== heavy.sector) {
      const members = selected.filter((s) => s.sector === heavy.sector);
      const drop = members[members.length - 1];
      selected = [...selected.filter((s) => s !== drop), incoming].sort((a, b) => rankOf.get(a.code)! - rankOf.get(b.code)!);
      replaced = true;
    }
  }

  const sectors = countSectors(selected);
  const warnings: BasketWarning[] = [];
  for (const s of sectors) {
    if (s.count < BASKET_SECTOR_WARN || s.sector === UNKNOWN_SECTOR) continue;
    const members = selected.filter((e) => e.sector === s.sector);
    const alt = candidates.find((c) => !selected.includes(c) && c.sector !== s.sector) ?? null;
    warnings.push({ sector: s.sector, count: s.count, dropCode: members[members.length - 1].code, alt });
  }

  const totalYen = selected.reduce((a, e) => a + e.amountYen, 0);
  return {
    entries: selected,
    totalYen,
    usageRate: budgetYen > 0 ? totalYen / budgetYen : 0,
    weightedWinRate: totalYen > 0 ? selected.reduce((a, e) => a + e.winRate * e.amountYen, 0) / totalYen : null,
    sectors,
    warnings,
    shortfall: Math.max(0, splitCount - selected.length),
    replaced,
  };
}
