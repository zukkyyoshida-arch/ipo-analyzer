"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Segmented } from "@/components/ui/Segmented";
import { MARKET_OPTIONS, type AdvancedFilters } from "./types";

/**
 * 一覧の詳細フィルタ（市場・ウォッチのみ・データ十分のみ）を選ぶBottomSheet。
 * @param open 表示状態
 * @param onClose 閉じる要求時のコールバック
 * @param filters 現在の詳細フィルタ状態
 * @param onChange 詳細フィルタ変更時のコールバック
 */
export function FilterSheet({
  open,
  onClose,
  filters,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  filters: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="フィルタ">
      <div className="space-y-5 pb-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">市場</p>
          <Segmented
            options={[
              { value: "all" as const, label: "すべて" },
              ...MARKET_OPTIONS.map((m) => ({ value: m, label: m })),
            ]}
            value={filters.market}
            onChange={(market) => onChange({ ...filters, market })}
          />
        </div>

        <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-text">
          ウォッチのみ表示
          <input
            type="checkbox"
            checked={filters.watchedOnly}
            onChange={(e) =>
              onChange({ ...filters, watchedOnly: e.target.checked })
            }
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>

        <label className="flex min-h-11 items-center justify-between gap-2 text-sm text-text">
          データ十分な銘柄のみ表示
          <input
            type="checkbox"
            checked={filters.sufficientOnly}
            onChange={(e) =>
              onChange({ ...filters, sufficientOnly: e.target.checked })
            }
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>
      </div>
    </BottomSheet>
  );
}
