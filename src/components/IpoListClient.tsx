"use client";

import { useMemo, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import Link from "next/link";
import { Disclaimer } from "./Disclaimer";
import { Segmented } from "./ui/Segmented";
import { SearchInput } from "./ipos/SearchInput";
import { SortAndFilterBar } from "./ipos/SortAndFilterBar";
import { FilterSheet } from "./ipos/FilterSheet";
import { IpoResultList, type ScoredIpo } from "./ipos/IpoResultList";
import {
  DEFAULT_ADVANCED_FILTERS,
  STAGE_OPTIONS,
  matchesStage,
  type AdvancedFilters,
  type SortKey,
  type StageFilter,
} from "./ipos/types";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist } from "@/hooks/useUserData";
import { scoreIpo, overallScore } from "@/lib/scoring";
import { initialReturnRate } from "@/lib/format";
import { assessCompleteness } from "@/lib/completeness";

/** 検索文字列の正規化（大小文字・全角半角の違いを緩く吸収）。 */
function normalizeQuery(text: string): string {
  return text.trim().toLowerCase();
}

export function IpoListClient({
  ipos,
  market,
}: {
  ipos: Ipo[];
  market: MarketData;
}) {
  const { settings } = useSettings(market.sentiment);
  const { isWatched, toggle } = useWatchlist();

  const [stage, setStage] = useState<StageFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("listingDate");
  const [advanced, setAdvanced] = useState<AdvancedFilters>(
    DEFAULT_ADVANCED_FILTERS,
  );
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // 各銘柄のスコア・データ充足度を計算（設定変更で再計算）。
  const scored = useMemo<ScoredIpo[]>(() => {
    return ipos.map((ipo) => {
      const result = scoreIpo(ipo, settings);
      return {
        ipo,
        supply: result.supplyDemand.score,
        funda: result.fundamental.score,
        overall: overallScore(result),
        completeness: assessCompleteness(ipo).level,
      };
    });
  }, [ipos, settings]);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    const list = scored.filter(({ ipo, completeness }) => {
      if (!matchesStage(ipo.status, stage)) return false;
      if (advanced.market !== "all" && ipo.market !== advanced.market)
        return false;
      if (advanced.watchedOnly && !isWatched(ipo.code)) return false;
      if (advanced.sufficientOnly && completeness === "insufficient")
        return false;
      if (q.length > 0) {
        const nameMatch = ipo.name.toLowerCase().includes(q);
        const codeMatch = ipo.code.toLowerCase().includes(q);
        if (!nameMatch && !codeMatch) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "score") return b.overall - a.overall;
      if (sortKey === "returnRate") {
        const ra = initialReturnRate(a.ipo);
        const rb = initialReturnRate(b.ipo);
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb - ra;
      }
      return b.ipo.listingDate.localeCompare(a.ipo.listingDate);
    });
    return list;
  }, [scored, stage, advanced, isWatched, query, sortKey]);

  const activeFilterCount =
    (advanced.market !== "all" ? 1 : 0) +
    (advanced.watchedOnly ? 1 : 0) +
    (advanced.sufficientOnly ? 1 : 0);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-text">銘柄</h1>
      <Link
        href="/events"
        className="mb-2 flex min-h-11 items-center text-xs font-medium text-accent-2 active:opacity-80"
      >
        イベントカレンダーを見る →
      </Link>

      <div className="mb-3">
        <Segmented options={STAGE_OPTIONS} value={stage} onChange={setStage} />
      </div>

      <div className="mb-3">
        <SearchInput value={query} onChange={setQuery} />
      </div>

      <div className="mb-3">
        <SortAndFilterBar
          sortKey={sortKey}
          onSortChange={setSortKey}
          onOpenFilter={() => setFilterSheetOpen(true)}
          activeFilterCount={activeFilterCount}
        />
      </div>

      <p className="mb-3 text-xs text-muted">{filtered.length}件表示</p>

      <IpoResultList
        items={filtered}
        isWatched={isWatched}
        onToggleWatch={toggle}
      />

      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={advanced}
        onChange={setAdvanced}
      />

      <Disclaimer />
    </div>
  );
}
