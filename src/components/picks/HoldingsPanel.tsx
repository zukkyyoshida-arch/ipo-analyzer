"use client";

import { useMemo } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/ui/InfoHint";
import {
  MoreButton,
  RankCountLine,
  RankFilterBar,
  rankRows,
  usePaged,
  useRankState,
  type RankChip,
  type RankSortOption,
} from "@/components/picks/RankedFilter";
import { formatMonthDay } from "@/lib/hot/file";
import { formatJstDateTime } from "@/lib/date";
import { formatHoldingDelta } from "@/lib/holdings/file";
import { HOLDINGS_ATTRIBUTION } from "@/lib/holdings/types";
import {
  holdingRatioText,
  type HoldingsMethodPick,
  type HoldingsMethodResult,
} from "@/lib/picks/holdings";

// 行の格子。スマホは「ラベル・コード・銘柄・保有割合」、1280px も同じ 4 列（BB・短期セカンダリと同じ組み方）。
const ROW_GRID = "grid grid-cols-[3.25rem_2.5rem_minmax(0,1fr)_auto] gap-x-3";

/** 絞り込みチップの種類。 */
type FilterId = "today" | "week" | "new" | "add" | "noSpecial" | "invest" | "d1" | "r10" | "proposal" | "multi";

const FILTER_CHIPS: RankChip<FilterId>[] = [
  { id: "today", label: "今日", title: "今日提出されたもの" },
  { id: "week", label: "直近1週間", title: "今日を含む7日以内に提出されたもの" },
  { id: "new", label: "新規", title: "新規に5%を超えた報告" },
  { id: "add", label: "買い増し", title: "変更報告書で保有割合が増えた報告" },
  { id: "noSpecial", label: "特例を除く", title: "特例対象株券等の報告を除く" },
  { id: "invest", label: "純投資", title: "保有目的に「純投資」を含む" },
  { id: "d1", label: "+1pt以上", title: "保有割合が1ポイント以上増えた" },
  { id: "r10", label: "10%以上", title: "保有割合が10%以上" },
  { id: "proposal", label: "重要提案あり", title: "重要提案行為等を行うことを報告している" },
  { id: "multi", label: "複数回", title: "期間内に2回以上提出された" },
];

const FILTER_IDS: FilterId[] = FILTER_CHIPS.map((c) => c.id);

type SortKey = "rank" | "ratio" | "delta" | "count";

const SORT_OPTIONS: RankSortOption<SortKey>[] = [
  { key: "rank", label: "順位（提出日の新しい順）" },
  { key: "ratio", label: "保有割合の高い順" },
  { key: "delta", label: "増加幅の大きい順" },
  { key: "count", label: "提出件数の多い順" },
];

const SORT_KEYS: SortKey[] = SORT_OPTIONS.map((o) => o.key);

function matchFilter(id: FilterId, pick: HoldingsMethodPick): boolean {
  const { latest } = pick;
  switch (id) {
    case "today": return (pick.filings[0]?.elapsedDays ?? Infinity) === 0;
    case "week": return (pick.filings[0]?.elapsedDays ?? Infinity) < 7;
    case "new": return pick.label.startsWith("新規");
    case "add": return pick.label.startsWith("買い増し");
    case "noSpecial": return !pick.label.includes("（特例）");
    case "invest": return (latest.purpose ?? "").includes("純投資");
    case "d1": return latest.delta !== null && latest.delta >= 0.01 - 1e-9;
    case "r10": return latest.ratio !== null && latest.ratio >= 0.1 - 1e-9;
    case "proposal": return latest.proposal === true;
    case "multi": return pick.filings.length >= 2;
  }
}

function sortValue(pick: HoldingsMethodPick, key: SortKey): number | null {
  switch (key) {
    case "ratio": return pick.latest.ratio;
    case "delta": return pick.latest.delta;
    case "count": return pick.filings.length;
    default: return null;
  }
}

/**
 * ホームの「ピックアップ」→「大量保有」。大量保有報告書の「新規 5% 超」「保有割合の増加」を銘柄ごとに並べる。
 * 判定は lib/picks/holdings.ts（pickHoldingsMethod）でサーバーが済ませ、ここは直近 30 日の全件に順位を付け、
 * 絞り込みチップ・並び順・「さらに見る」を出すだけ（順位は絞り込み・並び替えをしても固定）。
 * @param result 直近 30 日の提出の結果（全件）
 */
export function HoldingsPanel({ result }: { result: HoldingsMethodResult }) {
  const { filters, sort, toggle, clear, setSort } = useRankState<FilterId, SortKey>(
    "holdings.rank",
    FILTER_IDS,
    SORT_KEYS,
    "rank",
  );
  const rows = useMemo(
    () => rankRows(result.picks, filters, matchFilter, sort, "rank", sortValue),
    [result.picks, filters, sort],
  );
  const { shown, rest, more } = usePaged(rows, `${filters.join(",")}|${sort}`);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">
          大量保有の新規・増加
          <InfoHint title="見方と注意">
        <p>
          対象は大量保有報告書の新規 5% 超と、変更報告書で保有割合が増えたものだけです（減少・5% 割れ・上場時の報告は出しません）。
        </p>
        <p>
          並びは提出日の新しい順です。過去データでは提出後の値動きに一定の傾向は見られませんでした（2024〜2026 年、1,250 件）。
        </p>
        <p>決算進捗（1Q 30%・2Q 60%・3Q 80% 以上）での絞り込みは未対応です。</p>
        <p>報告は義務発生から最大 5 営業日遅れて出ます。判断材料であり売買推奨ではありません。</p>
          </InfoHint>
        </h2>
        {result.intradayFetchedAt ? (
          <span className="text-xs tabular-nums text-subtle">{formatJstDateTime(result.intradayFetchedAt).slice(5)} 時点</span>
        ) : result.coveredThrough ? (
          <span className="text-xs tabular-nums text-subtle">{formatMonthDay(result.coveredThrough)}提出分まで</span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-subtle">今日の提出は平日 9〜17 時に毎時更新しています（EDINET）。</p>

      {result.stale ? (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          大量保有報告書のデータが更新待ちです。表示は取得済みの分だけです。
        </p>
      ) : null}

      {result.picks.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">直近 30 日に新規・増加の報告はありません</p>
      ) : (
        <>
          <RankFilterBar
            chips={FILTER_CHIPS}
            filters={filters}
            sort={sort}
            sortOptions={SORT_OPTIONS}
            onToggle={toggle}
            onClear={clear}
            onSort={setSort}
          />
          <RankCountLine total={result.picks.length} shown={rows.length} unit="銘柄" note="直近30日" className="mt-2" />
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">条件に当てはまる銘柄はありません</p>
          ) : (
            <>
              <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
                <span className="col-span-3">銘柄・提出者</span>
                <span className="text-right">保有割合</span>
              </div>
              <ol>
                {shown.map(({ item, rank }) => (
                  <HoldingsRow key={item.code} pick={item} rank={rank} />
                ))}
              </ol>
              <MoreButton rest={rest} onMore={more} />
            </>
          )}
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
        <p>大量保有報告書で保有が増えた銘柄を、提出日の新しい順に並べます。</p>
        <p>
          出典：
          <a href={HOLDINGS_ATTRIBUTION.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {HOLDINGS_ATTRIBUTION.sourceLabel}
          </a>
          、
          <a href={HOLDINGS_ATTRIBUTION.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {HOLDINGS_ATTRIBUTION.licenseLabel}
          </a>
          。{HOLDINGS_ATTRIBUTION.processedNote}
        </p>
      </div>
    </section>
  );
}

function HoldingsRow({ pick, rank }: { pick: HoldingsMethodPick; rank: number }) {
  const { latest } = pick;
  const extra = pick.filings.length - 1;
  return (
    <li className="border-b border-border last:border-b-0">
      <Link href={`/ipo/${pick.code}`} prefetch={false} className={`${ROW_GRID} items-center py-3 active:opacity-80`}>
        <span className="text-[11px] font-medium leading-tight text-accent">
          <span className="block tabular-nums text-subtle">{rank}位</span>
          {pick.label}
        </span>
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {pick.code}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-text">{pick.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
            <span className="tabular-nums">{formatMonthDay(latest.submitDate)}提出</span>
            <span className="min-w-0 truncate text-muted">{latest.filer}</span>
            {extra > 0 ? <span>ほか {extra} 件</span> : null}
          </span>
          {latest.purpose ? (
            <span className="block truncate text-[11px] text-subtle">目的：{latest.purpose}</span>
          ) : null}
        </span>
        <span className="flex flex-col items-end">
          <span className="whitespace-nowrap text-sm font-medium tabular-nums text-text">{holdingRatioText(latest)}</span>
          {latest.delta !== null ? (
            <span className="mt-1 whitespace-nowrap text-[11px] tabular-nums text-up">{formatHoldingDelta(latest.delta)}</span>
          ) : (
            <span className="mt-1 text-[11px] text-subtle">新規</span>
          )}
        </span>
      </Link>
    </li>
  );
}
