"use client";

import { useState, type JSX } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Chip } from "@/components/ui/Chip";

/**
 * ピックアップ各タブ共通の「全銘柄を順位付きで出し、絞り込みはユーザーがチップで選ぶ」部品。
 * 優待の YutaiRulePicks が手本。
 */

/** 絞り込みチップ 1 個。 */
export interface RankChip<Id extends string> {
  id: Id;
  label: string;
  title?: string;
}

/** 並び順の選択肢 1 個。 */
export interface RankSortOption<K extends string> {
  key: K;
  label: string;
}

/**
 * 絞り込みチップと並び順を localStorage（`${storagePrefix}.filters` = string[] / `${storagePrefix}.sort` = string）に保存し、
 * 妥当な値（chipIds / sortKeys に含まれるもの）だけを返す。壊れた値は無視。
 * extraValid(id) を渡すと、chipIds に無くても true を返す id を有効扱いにする（優待の「予算内」チップのような動的チップ用）。
 */
export function useRankState<Id extends string, K extends string>(
  storagePrefix: string,
  chipIds: readonly Id[],
  sortKeys: readonly K[],
  defaultSort: K,
  extraValid?: (id: string) => boolean,
): { filters: Id[]; sort: K; toggle: (id: Id) => void; clear: () => void; setSort: (k: K) => void } {
  const [storedFilters, setFilters] = useLocalStorage<string[]>(`${storagePrefix}.filters`, []);
  const [storedSort, setStoredSort] = useLocalStorage<string>(`${storagePrefix}.sort`, defaultSort);
  const filters = (Array.isArray(storedFilters) ? storedFilters : []).filter(
    (f): f is Id =>
      typeof f === "string" && ((chipIds as readonly string[]).includes(f) || (extraValid ? extraValid(f) : false)),
  );
  const sort: K =
    typeof storedSort === "string" && (sortKeys as readonly string[]).includes(storedSort)
      ? (storedSort as K)
      : defaultSort;
  const toggle = (id: Id) =>
    setFilters(filters.includes(id) ? filters.filter((f) => f !== id) : [...filters, id]);
  return {
    filters,
    sort,
    toggle,
    clear: () => setFilters([]),
    setSort: (k: K) => setStoredSort(k),
  };
}

/**
 * 母集団 items（既定順）に 1 始まりの順位を付けて固定し、filters を全て満たすものだけ残し、sort で並べ替える。
 * sort === defaultSort のときは既定順のまま。それ以外は sortValue の大きい順（null は末尾、同値は順位順）。
 * 純関数（React に依存しない）。
 */
export function rankRows<T, Id extends string, K extends string>(
  items: readonly T[],
  filters: readonly Id[],
  match: (id: Id, item: T) => boolean,
  sort: K,
  defaultSort: K,
  sortValue: (item: T, key: K) => number | null,
): { item: T; rank: number }[] {
  const kept = items
    .map((item, i) => ({ item, rank: i + 1 }))
    .filter((r) => filters.every((f) => match(f, r.item)));
  if (sort === defaultSort) return kept;
  const withValue = kept.map((r) => ({ r, v: sortValue(r.item, sort) }));
  withValue.sort((a, b) => {
    if (a.v === null && b.v === null) return a.r.rank - b.r.rank;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    return b.v - a.v || a.r.rank - b.r.rank;
  });
  return withValue.map((x) => x.r);
}

/** チップの列（aria-pressed のボタンに Chip tone selected/neutral）＋「解除」＋「並び順」select。 */
export function RankFilterBar<Id extends string, K extends string>({
  chips,
  filters,
  sort,
  sortOptions,
  onToggle,
  onClear,
  onSort,
  className = "mt-3",
}: {
  chips: readonly RankChip<Id>[];
  filters: readonly Id[];
  sort: K;
  sortOptions: readonly RankSortOption<K>[];
  onToggle: (id: Id) => void;
  onClear: () => void;
  onSort: (k: K) => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={className} aria-label="絞り込み">
      <div className="flex flex-wrap items-center gap-1">
        {chips.map((c) => {
          const on = filters.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              title={c.title}
              onClick={() => onToggle(c.id)}
              className="rounded-full active:opacity-80"
            >
              <Chip tone={on ? "selected" : "neutral"}>{c.label}</Chip>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onClear}
          disabled={filters.length === 0}
          className="px-2 py-1 text-[11px] text-muted underline-offset-2 disabled:opacity-40"
        >
          解除
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        並び順
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as K)}
          className="min-h-9 rounded-lg border border-border bg-surface-2 px-2 text-xs text-text"
        >
          {sortOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** 「全 {total}{unit} → 表示 {shown}{unit}」の行。note があれば「（note）」を後ろに付ける。 */
export function RankCountLine({
  total,
  shown,
  unit = "件",
  note,
  className = "mt-1",
}: {
  total: number;
  shown: number;
  unit?: string;
  note?: string;
  className?: string;
}): JSX.Element {
  return (
    <p className={`${className} text-[11px] tabular-nums text-subtle`}>
      全 {total}{unit} → 表示 {shown}{unit}
      {note ? `（${note}）` : ""}
    </p>
  );
}

/** 1 回に見せる件数の既定値。 */
export const RANK_PAGE_SIZE = 30;

/** rows を pageSize ずつ見せる。resetKey が変わったら表示数を pageSize に戻す（絞り込み・並び替えが変わったとき用）。 */
export function usePaged<T>(
  rows: readonly T[],
  resetKey: string,
  pageSize: number = RANK_PAGE_SIZE,
): { shown: T[]; rest: number; more: () => void } {
  // レンダー中や effect 内で setState しないよう、前回の resetKey と一緒に持ち、違えば pageSize とみなす。
  const [state, setState] = useState({ key: resetKey, limit: pageSize });
  const limit = state.key === resetKey ? state.limit : pageSize;
  const shown = rows.slice(0, limit);
  return {
    shown,
    rest: rows.length - shown.length,
    more: () => setState({ key: resetKey, limit: limit + pageSize }),
  };
}

/** 「さらに N 件を見る（残り M 件）」ボタン。rest が 0 なら null。 */
export function MoreButton({
  rest,
  onMore,
  pageSize = RANK_PAGE_SIZE,
}: {
  rest: number;
  onMore: () => void;
  pageSize?: number;
}): JSX.Element | null {
  if (rest <= 0) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-border text-sm text-text active:opacity-80"
    >
      さらに {Math.min(pageSize, rest)} 件を見る（残り {rest} 件）
    </button>
  );
}
