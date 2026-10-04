"use client";

import { useState } from "react";
import type { Ipo } from "@/types/ipo";
import { IpoCard, type IpoCardCompleteness } from "@/components/IpoCard";
import { EmptyState } from "@/components/ui/EmptyState";

export const PAGE_SIZE = 40;

export interface ScoredIpo {
  ipo: Ipo;
  supply: number;
  funda: number;
  overall: number;
  completeness: IpoCardCompleteness;
}

/**
 * 銘柄カード一覧。初期表示40件＋「さらに表示」ボタンで追加表示する。
 * @param items 表示対象（フィルタ・ソート済み）
 * @param isWatched ウォッチ中判定
 * @param onToggleWatch ウォッチ星タップ時のコールバック
 */
export function IpoResultList({
  items,
  isWatched,
  onToggleWatch,
  visibleCount: controlledCount,
  onVisibleCountChange,
}: {
  items: ScoredIpo[];
  isWatched: (code: string) => boolean;
  onToggleWatch: (code: string) => void;
  /** 表示件数を親が保持する場合に指定（画面復元用）。省略時は内部状態。 */
  visibleCount?: number;
  onVisibleCountChange?: (n: number) => void;
}) {
  const [innerCount, setInnerCount] = useState(PAGE_SIZE);
  const visibleCount = controlledCount ?? innerCount;
  const setVisibleCount = (n: number) =>
    (onVisibleCountChange ?? setInnerCount)(n);

  if (items.length === 0) {
    return (
      <EmptyState
        title="該当する銘柄がありません"
        description="検索条件やフィルタを見直してください。"
      />
    );
  }

  const visible = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return (
    <div>
      <div className="rounded-xl border border-border bg-surface px-4 [&>a:last-child]:border-b-0">
        {visible.map(({ ipo, supply, funda, completeness }) => (
          <IpoCard
            key={ipo.code}
            ipo={ipo}
            supplyScore={supply}
            fundaScore={funda}
            watched={isWatched(ipo.code)}
            onToggleWatch={() => onToggleWatch(ipo.code)}
            completeness={completeness}
          />
        ))}
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
          className="mt-4 min-h-11 w-full rounded-xl border border-border bg-surface text-sm font-medium text-text active:opacity-80"
        >
          さらに表示（残り{items.length - visibleCount}件）
        </button>
      ) : null}
    </div>
  );
}
