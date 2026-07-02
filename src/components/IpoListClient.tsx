"use client";

import { useMemo, useState } from "react";
import type { Ipo, IpoStatus, Market } from "@/types/ipo";
import { IpoCard } from "./IpoCard";
import { ScoreNote } from "./Disclaimer";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist } from "@/hooks/useUserData";
import { scoreIpo, overallScore } from "@/lib/scoring";
import { STATUS_LABELS } from "@/lib/format";

type SortKey = "listingDate" | "score";
type StatusFilter = IpoStatus | "all";
type MarketFilter = Market | "all";

const MARKETS: Market[] = ["グロース", "スタンダード", "プライム"];
const STATUSES: IpoStatus[] = ["upcoming", "bb_open", "priced", "listed"];

export function IpoListClient({ ipos }: { ipos: Ipo[] }) {
  const { settings } = useSettings();
  const { isWatched, toggle } = useWatchlist();

  const [sortKey, setSortKey] = useState<SortKey>("listingDate");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [watchedOnly, setWatchedOnly] = useState(false);

  // 各銘柄のスコアを計算（設定変更で再計算）。
  const scored = useMemo(() => {
    return ipos.map((ipo) => {
      const result = scoreIpo(ipo, settings);
      return {
        ipo,
        supply: result.supplyDemand.score,
        funda: result.fundamental.score,
        overall: overallScore(result),
      };
    });
  }, [ipos, settings]);

  const filtered = useMemo(() => {
    const list = scored.filter(({ ipo }) => {
      if (statusFilter !== "all" && ipo.status !== statusFilter) return false;
      if (marketFilter !== "all" && ipo.market !== marketFilter) return false;
      if (watchedOnly && !isWatched(ipo.code)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sortKey === "score") return b.overall - a.overall;
      return a.ipo.listingDate.localeCompare(b.ipo.listingDate);
    });
    return list;
  }, [scored, statusFilter, marketFilter, watchedOnly, isWatched, sortKey]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">銘柄一覧</h1>
        <ScoreNote className="mt-1" />
      </div>

      {/* フィルタ・ソート */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label="並び替え"
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
            options={[
              { value: "listingDate", label: "上場日順" },
              { value: "score", label: "総合スコア順" },
            ]}
          />
          <FilterSelect
            label="市場"
            value={marketFilter}
            onChange={(v) => setMarketFilter(v as MarketFilter)}
            options={[
              { value: "all", label: "すべて" },
              ...MARKETS.map((m) => ({ value: m, label: m })),
            ]}
          />
          <FilterSelect
            label="状況"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: "all", label: "すべて" },
              ...STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
              })),
            ]}
          />
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={watchedOnly}
            onChange={(e) => setWatchedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          ウォッチリストのみ表示
        </label>
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          該当する銘柄がありません。
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ ipo, supply, funda }) => (
            <IpoCard
              key={ipo.code}
              ipo={ipo}
              supplyScore={supply}
              fundaScore={funda}
              watched={isWatched(ipo.code)}
              onToggleWatch={() => toggle(ipo.code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
