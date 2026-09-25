"use client";

import { IconButton } from "@/components/ui/IconButton";
import { SORT_OPTIONS, type SortKey } from "./types";

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

/**
 * ソート選択（native select）とフィルタボタンの行。
 * @param sortKey 現在のソートキー
 * @param onSortChange ソート変更時のコールバック
 * @param onOpenFilter フィルタボタンタップ時のコールバック
 * @param activeFilterCount 詳細フィルタの適用中件数（0なら無地のボタン）
 */
export function SortAndFilterBar({
  sortKey,
  onSortChange,
  onOpenFilter,
  activeFilterCount,
}: {
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  onOpenFilter: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-text">
        <span className="shrink-0 text-xs text-muted">並び替え</span>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="並び替え"
          className="min-w-0 flex-1 bg-transparent text-sm text-text focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        onClick={onOpenFilter}
        ariaLabel="フィルタを開く"
        className={`relative border ${
          activeFilterCount > 0
            ? "border-accent bg-accent/15 text-accent"
            : "border-border bg-surface text-text"
        }`}
      >
        <FilterIcon />
        {activeFilterCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
            {activeFilterCount}
          </span>
        ) : null}
      </IconButton>
    </div>
  );
}
