import { addDaysIso, daysBetween } from "@/lib/date";
import { isHoldingsStale } from "@/lib/holdings/file";
import { isListingTimeReport, HOLDINGS_THRESHOLD_RATIO } from "@/lib/holdings/score";
import { HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "@/lib/holdings/types";

// ホームの「ピックアップ」→「大量保有」。大量保有報告書のうち「新規 5% 超」と「保有割合の増加」だけを拾い、
// 銘柄ごとに提出日の新しい順で並べる純関数（Date.now を使わない。今日は todayIso で受け取る）。
// 点数では並べない: バックテスト（2024〜2026 年・1,250 件）で点数と提出後の値動きに関係が見られなかったため
// （本人裁定 2026-10-01）。新規／買い増しのラベルだけを付ける。
// - 対象: 新規 5% 超（大量保有報告書。上場に伴う報告は除く）と、変更報告書で保有割合が増えたもの。
//   減少・5% 割れ・短期大量譲渡は対象外（表示もしない。本人方針 2026-09-30）。

/** 表示モード。today = JST の今日に提出されたもの／week = 今日を含む直近 7 日。 */
export type HoldingsWindow = "today" | "week";

/** 直近 1 週間の日数（今日を含む）。 */
export const HOLDINGS_WEEK_DAYS = 7;
/** 並べる件数の上限。 */
export const HOLDINGS_METHOD_LIMIT = 20;

const EPSILON = 1e-9;

/** 1 件の提出（期間内・対象のもの）。elapsedDays は提出日から今日までの日数。 */
export interface HoldingsMethodFiling {
  item: HoldingItem;
  elapsedDays: number;
}

/** 1 銘柄の行。latest は期間内で最新の対象の提出。 */
export interface HoldingsMethodPick {
  code: string;
  name: string;
  /** 最新の対象の提出 */
  latest: HoldingItem;
  /** 期間内の対象の提出（新しい順） */
  filings: HoldingsMethodFiling[];
  /** 表示ラベル。「新規」「買い増し」（特例は「（特例）」付き） */
  label: string;
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
  /** 日中取得分（平日 9〜17 時の毎時）を最後に取った時刻（ISO。無ければ ""） */
  intradayFetchedAt: string;
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

/** 1 件の表示ラベル（対象外は null）。 */
export function holdingsMethodLabel(item: HoldingItem): string | null {
  if (!isHoldingsMethodTarget(item)) return null;
  const special = item.formType === "newSpecial" || item.formType === "changeSpecial";
  const base = isNewHolder(item) ? "新規" : "買い増し";
  return special ? `${base}（特例）` : base;
}

/**
 * 表示モードの期間に提出された「新規 5% 超」「増加」を銘柄ごとにまとめて並べる。
 * 並びは最新の提出日の新しい順 → 銘柄コードの昇順。点数は付けない。
 * file が null・空でも落ちない（空の結果を返す）。
 */
export function pickHoldingsMethod(
  file: HoldingsFile | null,
  todayIso: string,
  window: HoldingsWindow,
  limit = HOLDINGS_METHOD_LIMIT,
): HoldingsMethodResult {
  const span = window === "today" ? 1 : HOLDINGS_WEEK_DAYS;
  const byCode = new Map<string, HoldingsMethodFiling[]>();
  for (const item of file?.items ?? []) {
    const elapsed = daysBetween(item.submitDate, todayIso);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= span) continue;
    if (!isHoldingsMethodTarget(item)) continue;
    const list = byCode.get(item.code) ?? [];
    list.push({ item, elapsedDays: elapsed });
    byCode.set(item.code, list);
  }

  const rows: HoldingsMethodPick[] = [];
  for (const [code, filings] of byCode) {
    filings.sort(
      (a, b) =>
        a.elapsedDays - b.elapsedDays ||
        (a.item.docId < b.item.docId ? 1 : a.item.docId > b.item.docId ? -1 : 0),
    );
    const latest = filings[0].item;
    rows.push({ code, name: latest.name, latest, filings, label: holdingsMethodLabel(latest) ?? "" });
  }
  rows.sort(
    (a, b) =>
      (a.latest.submitDate < b.latest.submitDate ? 1 : a.latest.submitDate > b.latest.submitDate ? -1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );

  return {
    window,
    from: window === "today" ? todayIso : addDaysIso(todayIso, -(HOLDINGS_WEEK_DAYS - 1)),
    to: todayIso,
    coveredThrough: file?.coveredThrough ?? "",
    stale: isHoldingsStale(file, todayIso),
    intradayFetchedAt: file?.intradayFetchedAt ?? "",
    picks: rows.slice(0, Math.max(0, Math.floor(limit))),
    source: HOLDINGS_SOURCE_TEXT,
  };
}

/** 「新規 16.4%」「5.0% → 7.1%」のような保有割合の短い表記。 */
export function holdingRatioText(item: HoldingItem): string {
  if (item.ratio === null) return "—";
  if (item.prevRatio === null) return ratioPct(item.ratio);
  return `${ratioPct(item.prevRatio)} → ${ratioPct(item.ratio)}`;
}
