import { addDaysIso, daysBetween } from "@/lib/date";
import { formatHoldingDelta, isHoldingsStale } from "@/lib/holdings/file";
import {
  classifyPurpose,
  holdingDecayWeight,
  holdingFilingPoints,
  holdingReasons,
  holdingTone,
  isListingTimeReport,
  HOLDINGS_POINTS,
  HOLDINGS_SCORE_LIMIT,
  HOLDINGS_THRESHOLD_RATIO,
  type HoldingPick,
  type HoldingSignal,
  type ScoredHoldingFiling,
} from "@/lib/holdings/score";
import { HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "@/lib/holdings/types";

// ホームの「ピックアップ」→「大量保有」。大量保有報告書のうち「新規 5% 超」と「保有割合の増加」だけを拾い、
// 銘柄ごとに並べる純関数（Date.now を使わない。今日は todayIso で受け取る）。
// 点の付け方は lib/holdings/score.ts（注目度）を土台にし、この手法の条件だけを足す:
// - 対象: 新規 5% 超（大量保有報告書。上場に伴う報告は除く）と、変更報告書で保有割合が増えたもの。
//   減少・5% 割れ・短期大量譲渡は対象外（表示もしない。本人方針 2026-09-30）。
// - 1 件の点: score.ts の holdingFilingPoints（新規 +40〜・買い増し +20〜・提携／経営参加／重要提案の加点・特例は半分）。
//   変更報告書の提出基準（1pt）に満たない増加は score.ts では 0 点なので、ここでは SMALL_INCREASE 点を付ける（仮置き）。
// - 保有目的が純投資（投資収益性を重視）なら PURE_INVESTMENT 点を足す（仮置き）。
// - 減衰: 提出日から HALF_LIFE_DAYS 日で半分（score.ts と同じ式。半減期だけこの手法用に短くする。仮置き）。
// - 決算進捗（1Q≥30%・2Q≥60%・3Q≥80%）での絞り込みは、進捗のデータが無いので未対応（画面に注記を出す）。

/** 表示モード。today = JST の今日に提出されたもの／week = 今日を含む直近 7 日。 */
export type HoldingsWindow = "today" | "week";

/** 直近 1 週間の日数（今日を含む）。 */
export const HOLDINGS_WEEK_DAYS = 7;
/** この手法の減衰の半減期（日）。設計書 §2-5「1 週間で半減」（仮置き）。 */
export const HOLDINGS_METHOD_HALF_LIFE_DAYS = 7;
/** 1pt 未満の増加の点（仮置き。1pt 以上の買い増し +20 の半分）。 */
export const HOLDINGS_METHOD_SMALL_INCREASE_POINTS = 10;
/** 保有目的が純投資のときの加点（仮置き。提携・経営参加 +20 の半分）。 */
export const HOLDINGS_METHOD_PURE_INVESTMENT_POINTS = 10;
/** 並べる件数の上限。 */
export const HOLDINGS_METHOD_LIMIT = 20;

const EPSILON = 1e-9;

/** 1 銘柄の行。HoldingPick（注目度）の形をそのまま使い、latest は期間内で最新の対象の提出。 */
export interface HoldingsMethodPick extends HoldingPick {
  /** 順位（1 始まり） */
  rank: number;
}

/** pickHoldingsMethod の結果。 */
export interface HoldingsMethodResult {
  window: HoldingsWindow;
  /** 期間の始まり（提出日。today なら todayIso と同じ） */
  from: string;
  /** 期間の終わり（= todayIso） */
  to: string;
  /** 取得済みの最新の提出日（""＝未取得） */
  coveredThrough: string;
  /** データが古い（更新待ち）か */
  stale: boolean;
  picks: HoldingsMethodPick[];
  /** 出典表記（画面に必ず出す） */
  source: string;
}

function ratioPct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

/** 新規 5% 超（上場に伴う報告を除く）か。 */
function isNewHolder(item: HoldingItem): boolean {
  if (item.formType !== "new" && item.formType !== "newSpecial") return false;
  if (isListingTimeReport(item)) return false;
  return item.ratio === null || item.ratio >= HOLDINGS_THRESHOLD_RATIO - EPSILON;
}

/** 変更報告書で保有割合が増えたか（短期大量譲渡は除く）。 */
function isIncrease(item: HoldingItem): boolean {
  if (item.formType !== "change" && item.formType !== "changeSpecial") return false;
  return item.delta !== null && item.delta > EPSILON;
}

/** この手法の対象か（新規 5% 超・増加）。 */
export function isHoldingsMethodTarget(item: HoldingItem): boolean {
  return isNewHolder(item) || isIncrease(item);
}

/** この手法での 1 件の点と理由（対象外は null）。 */
export function holdingsMethodPoints(item: HoldingItem): { points: number; signals: HoldingSignal[] } | null {
  if (!isHoldingsMethodTarget(item)) return null;
  const special = item.formType === "newSpecial" || item.formType === "changeSpecial";
  const factor = special ? HOLDINGS_POINTS.specialFactor : 1;
  const base = holdingFilingPoints(item);
  let points = base.points;
  const signals = [...base.signals];
  if (points <= 0 && item.delta !== null) {
    // 1pt 未満の増加（score.ts では 0 点）
    points = HOLDINGS_METHOD_SMALL_INCREASE_POINTS * factor;
    signals.unshift({ kind: "increase", label: `増加 ${formatHoldingDelta(item.delta)}` });
  }
  if (classifyPurpose(item.purpose, item.proposal === true).pureInvestment) {
    points += HOLDINGS_METHOD_PURE_INVESTMENT_POINTS * factor;
    signals.push({ kind: "pureInvestment", label: "純投資" });
  }
  return { points, signals };
}

/**
 * 表示モードの期間に提出された「新規 5% 超」「増加」を銘柄ごとにまとめて並べる。
 * 並びは点（Σ 減衰の重み × 点）の高い順 → 最新の提出日の新しい順 → 銘柄コードの昇順。
 * file が null・空でも落ちない（空の結果を返す）。
 */
export function pickHoldingsMethod(
  file: HoldingsFile | null,
  todayIso: string,
  window: HoldingsWindow,
  limit = HOLDINGS_METHOD_LIMIT,
): HoldingsMethodResult {
  const span = window === "today" ? 1 : HOLDINGS_WEEK_DAYS;
  const byCode = new Map<string, ScoredHoldingFiling[]>();
  for (const item of file?.items ?? []) {
    const elapsed = daysBetween(item.submitDate, todayIso);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= span) continue;
    const scored = holdingsMethodPoints(item);
    if (!scored) continue;
    const weight = holdingDecayWeight(elapsed, HOLDINGS_METHOD_HALF_LIFE_DAYS);
    const list = byCode.get(item.code) ?? [];
    list.push({ item, points: scored.points, weight, elapsedDays: elapsed, signals: scored.signals });
    byCode.set(item.code, list);
  }

  const rows: Omit<HoldingsMethodPick, "rank">[] = [];
  for (const [code, filings] of byCode) {
    filings.sort(
      (a, b) =>
        a.elapsedDays - b.elapsedDays ||
        (a.item.docId < b.item.docId ? 1 : a.item.docId > b.item.docId ? -1 : 0),
    );
    const raw = filings.reduce((sum, f) => sum + f.weight * f.points, 0);
    const score = Math.round(Math.min(HOLDINGS_SCORE_LIMIT, raw));
    const latest = filings[0].item;
    rows.push({
      code,
      name: latest.name,
      score,
      tone: holdingTone(score),
      latest,
      filings,
      reasons: holdingReasons(filings),
    });
  }
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      (a.latest.submitDate < b.latest.submitDate ? 1 : a.latest.submitDate > b.latest.submitDate ? -1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );

  return {
    window,
    from: window === "today" ? todayIso : addDaysIso(todayIso, -(HOLDINGS_WEEK_DAYS - 1)),
    to: todayIso,
    coveredThrough: file?.coveredThrough ?? "",
    stale: isHoldingsStale(file, todayIso),
    picks: rows.slice(0, Math.max(0, Math.floor(limit))).map((r, i) => ({ ...r, rank: i + 1 })),
    source: HOLDINGS_SOURCE_TEXT,
  };
}

/** 「新規 16.4%」「5.0% → 7.1%」のような保有割合の短い表記。 */
export function holdingRatioText(item: HoldingItem): string {
  if (item.ratio === null) return "—";
  if (item.prevRatio === null) return ratioPct(item.ratio);
  return `${ratioPct(item.prevRatio)} → ${ratioPct(item.ratio)}`;
}
