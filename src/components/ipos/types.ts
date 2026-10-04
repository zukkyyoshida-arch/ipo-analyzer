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

/** 一覧画面の復元対象状態（sessionStorage `ipos.list.v1`）。 */
export interface IpoListState {
  stage: StageFilter;
  query: string;
  sortKey: SortKey;
  advanced: AdvancedFilters;
  visibleCount: number;
}

export const DEFAULT_IPO_LIST_STATE: IpoListState = {
  stage: "all",
  query: "",
  sortKey: "listingDate",
  advanced: DEFAULT_ADVANCED_FILTERS,
  visibleCount: 40,
};

/** 保存値の検証。各項目が不正なら既定値にフォールバックする。オブジェクトでなければ null。 */
export function parseIpoListState(raw: unknown): IpoListState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_IPO_LIST_STATE;
  const adv =
    typeof r.advanced === "object" && r.advanced !== null
      ? (r.advanced as Record<string, unknown>)
      : {};
  const vc = r.visibleCount;
  return {
    stage: STAGE_OPTIONS.some((o) => o.value === r.stage)
      ? (r.stage as StageFilter)
      : d.stage,
    query: typeof r.query === "string" ? r.query.slice(0, 100) : d.query,
    sortKey: SORT_OPTIONS.some((o) => o.value === r.sortKey)
      ? (r.sortKey as SortKey)
      : d.sortKey,
    advanced: {
      market: (MARKET_OPTIONS as string[]).includes(adv.market as string)
        ? (adv.market as Market)
        : "all",
      watchedOnly: adv.watchedOnly === true,
      sufficientOnly: adv.sufficientOnly === true,
    },
    visibleCount:
      typeof vc === "number" && Number.isInteger(vc) && vc >= 40 && vc <= 10000
        ? vc
        : d.visibleCount,
  };
}
