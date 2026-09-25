import type { Ipo } from "@/types/ipo";
import { IpoCard } from "@/components/IpoCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { CompletenessLevel } from "@/lib/completeness";

export interface TopPickItem {
  ipo: Ipo;
  supply: number;
  funda: number;
  overall: number;
  completeness: CompletenessLevel;
}

/**
 * スコア上位ピックアップ。総合スコア降順・データ十分な銘柄のみ（topPicks で選定済み）。
 */
export function TopPicks({
  items,
  watched,
  onToggleWatch,
}: {
  items: TopPickItem[];
  watched: (code: string) => boolean;
  onToggleWatch: (code: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="条件一致の銘柄がまだありません"
        description="データが十分な銘柄が増えると、総合スコア上位をここに表示します。"
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map(({ ipo, supply, funda, completeness }) => (
        <IpoCard
          key={ipo.code}
          ipo={ipo}
          supplyScore={supply}
          fundaScore={funda}
          watched={watched(ipo.code)}
          onToggleWatch={() => onToggleWatch(ipo.code)}
          completeness={completeness}
        />
      ))}
    </div>
  );
}
