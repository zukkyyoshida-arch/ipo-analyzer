import type { IpoStatus, Market } from "@/types/ipo";

// /ipos 画面のみで使うフィルタ・ソートの型。URLには載せず useState で保持する。

/** 上部セグメント（すべて／予定／BB中／上場済）。bb_open と priced は「BB中」にまとめる。 */
export type StageFilter = "all" | "upcoming" | "bb" | "listed";

export const STAGE_OPTIONS: { value: StageFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "upcoming", label: "予定" },
  { value: "bb", label: "BB中" },
  { value: "listed", label: "上場済" },
];

/** ステージフィルタに合致するかどうか。 */
export function matchesStage(status: IpoStatus, stage: StageFilter): boolean {
  if (stage === "all") return true;
  if (stage === "bb") return status === "bb_open" || status === "priced";
  return status === stage;
}

export type SortKey = "listingDate" | "score" | "returnRate";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "listingDate", label: "上場日" },
  { value: "score", label: "総合スコア" },
  { value: "returnRate", label: "初値比騰落率" },
];

export const MARKET_OPTIONS: Market[] = ["グロース", "スタンダード", "プライム"];

/** 詳細フィルタ（BottomSheet）の状態。 */
export interface AdvancedFilters {
  market: Market | "all";
  watchedOnly: boolean;
  sufficientOnly: boolean;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  market: "all",
  watchedOnly: false,
  sufficientOnly: false,
};
