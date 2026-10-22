"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { normalizeBudgetMan } from "@/lib/yutai/entry";
import { InfoHint } from "@/components/ui/InfoHint";
import { Chip } from "@/components/ui/Chip";
import { formatMonthDay } from "@/lib/hot/file";
import {
  MoreButton,
  RankFilterBar,
  rankRows,
  usePaged,
  useRankState,
  type RankChip,
  type RankSortOption,
} from "@/components/picks/RankedFilter";
import {
  isPicksStale,
  parsePicksFile,
  pickRate,
  PICK_RULE_LABELS,
  YUTAI_PICKS_URL,
  type PickItem,
  type PickMonth,
  type PicksFile,
} from "@/lib/yutai/picksRules";

/** 末尾の固定注記。 */
export const YUTAI_RULE_PICKS_NOTE =
  "過去10年の同時期の成績で選んだ候補です。1銘柄あたりの勝率の上限は約77%、権利月ごとに上位10本を等金額で持った場合に80%台でした。母集団は今日優待がある銘柄で、途中で優待をやめた銘柄は含みません（生存バイアス）。売買推奨ではありません。順位は勝率→年数→平均の順です。";

function signedPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function manYen(yen: number): string {
  return `${Math.round(yen / 1000) / 10}万円`;
}

/** 絞り込みチップの種類。 */
type FilterId =
  | "rule" | "B" | "C" | "D"
  | "r70" | "r80" | "n5" | "n8"
  | "i10" | "i20" | "ma75" | "noEarn" | "s3" | "budget";

const FILTER_CHIPS: RankChip<FilterId>[] = [
  { id: "rule", label: "ルール該当", title: "B・C・D のどれかに当てはまる" },
  { id: "B", label: "B", title: PICK_RULE_LABELS.B },
  { id: "C", label: "C", title: PICK_RULE_LABELS.C },
  { id: "D", label: "D", title: PICK_RULE_LABELS.D },
  { id: "r70", label: "勝率70%以上" },
  { id: "r80", label: "勝率80%以上" },
  { id: "n5", label: "5年以上" },
  { id: "n8", label: "8年以上" },
  { id: "i10", label: "100株10万円以下" },
  { id: "i20", label: "100株20万円以下" },
  { id: "ma75", label: "75日線の下" },
  { id: "noEarn", label: "決算またぎを除く" },
  { id: "s3", label: "3連勝以上" },
];

const FILTER_IDS: FilterId[] = FILTER_CHIPS.map((c) => c.id);

type SortKey = "rank" | "avg" | "worst" | "streak" | "invest" | "ret1m";

const SORT_OPTIONS: RankSortOption<SortKey>[] = [
  { key: "rank", label: "順位（勝率→年数→平均）" },
  { key: "avg", label: "平均騰落率" },
  { key: "worst", label: "最悪の年" },
  { key: "streak", label: "連勝数" },
  { key: "invest", label: "100株の金額（安い順）" },
  { key: "ret1m", label: "直近1か月騰落率" },
];

const SORT_KEYS: SortKey[] = SORT_OPTIONS.map((o) => o.key);

/** 権利付最終日までに次の決算日が入っているか。 */
export function earningsInside(item: PickItem, lastCumDate: string, todayIso: string): boolean {
  return item.nextEarningsDate !== null && item.nextEarningsDate >= todayIso && item.nextEarningsDate <= lastCumDate;
}

function matchFilter(
  id: FilterId,
  item: PickItem,
  ctx: { lastCumDate: string; todayIso: string; budgetYen: number | null },
): boolean {
  switch (id) {
    case "rule": return item.rules.length > 0;
    case "B": case "C": case "D": return item.rules.includes(id);
    case "r70": return pickRate(item) >= 0.7;
    case "r80": return pickRate(item) >= 0.8;
    case "n5": return item.n >= 5;
    case "n8": return item.n >= 8;
    case "i10": return item.invest <= 100_000;
    case "i20": return item.invest <= 200_000;
    case "ma75": return item.aboveMa75 === false;
    case "noEarn": return !earningsInside(item, ctx.lastCumDate, ctx.todayIso);
    case "s3": return item.streak >= 3;
    case "budget": return ctx.budgetYen !== null && (item.minInvest ?? item.invest) <= ctx.budgetYen;
  }
}

function sortValue(item: PickItem, key: SortKey): number | null {
  switch (key) {
    case "avg": return item.avg;
    case "worst": return item.worst;
    case "streak": return item.streak;
    case "invest": return -item.invest;
    case "ret1m": return item.ret1m;
    default: return null;
  }
}

/** 取得の状態。undefined = 取得中、null = 無い・壊れている・通信失敗。 */
type Loaded = PicksFile | null | undefined;

/**
 * ホームの「ピックアップ」→「優待」の先頭に出す「検証ルールの候補」。
 * 夜間ジョブ（npm run yutai:picks）が作る /data/yutai/picks.json をブラウザから取って表示するだけ。
 * 手法: 権利付最終日の N 営業日前に買い、権利付最終日の大引けで売る（scripts/backtest/yutai/REPORT.md）。
 * 取得できない・古い（作成日が 7 日以上前）ときは「更新待ち」。
 * @param todayIso 日本時間の今日
 */
export function YutaiRulePicks({ todayIso }: { todayIso: string }) {
  const [file, setFile] = useState<Loaded>(undefined);
  const [budgetText] = useLocalStorage<string>("yutai.budgetMan", "");
  const budgetMan = normalizeBudgetMan(budgetText);
  const budgetYen = budgetMan === null ? null : budgetMan * 10_000;
  // 「予算内」チップは予算が入っているときだけ有効。
  const { filters, sort, toggle, clear, setSort } = useRankState<FilterId, SortKey>(
    "yutai.rank",
    FILTER_IDS,
    SORT_KEYS,
    "rank",
    (id) => id === "budget" && budgetYen !== null,
  );
  const chips: RankChip<FilterId>[] = budgetMan === null
    ? FILTER_CHIPS
    : [...FILTER_CHIPS, { id: "budget", label: `予算内（${budgetMan}万円）`, title: "優待の最低投資金額（なければ100株の金額）が予算以内" }];

  useEffect(() => {
    let alive = true;
    fetch(YUTAI_PICKS_URL)
      .then(async (res) => (res.ok ? parsePicksFile(await res.json()) : null))
      .catch(() => null)
      .then((f) => {
        if (alive) setFile(f);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stale = file ? isPicksStale(file.asOf, todayIso) : false;
  const ready = file !== undefined && file !== null && !stale;

  return (
    <section className="mb-4 rounded-xl border border-border bg-surface p-4" aria-label="同時期の過去成績ランキング">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">
          同時期の過去成績ランキング
          <InfoHint title="見方と注意">
            <p>{YUTAI_RULE_PICKS_NOTE}</p>
          </InfoHint>
        </h2>
        {file === undefined ? null : ready ? (
          <span className="text-xs tabular-nums text-subtle">{formatMonthDay(file.asOf)} 時点</span>
        ) : (
          <Chip tone="warn">更新待ち</Chip>
        )}
      </div>

      {file === undefined ? (
        <p className="py-6 text-center text-sm text-muted">読み込み中…</p>
      ) : !ready ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted">夜間のデータ更新で、検証済みのルールが選ぶ銘柄をここへ表示します</p>
          {file ? (
            <p className="mt-2 text-xs tabular-nums text-subtle">前回の作成: {formatMonthDay(file.asOf)}</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-subtle">権利付最終日の数十営業日前に買い、権利付最終日の大引けで売る</p>
          <MarketLine file={file} />
          {file.months.length === 0 ? (
            <p className="mt-3 text-sm text-muted">いま対象の権利月はありません</p>
          ) : (
            <>
              <RankFilterBar
                chips={chips}
                filters={filters}
                sort={sort}
                sortOptions={SORT_OPTIONS}
                onToggle={toggle}
                onClear={clear}
                onSort={setSort}
              />
              {file.months.map((m) => (
                <MonthBlock
                  key={m.month}
                  month={m}
                  todayIso={todayIso}
                  filters={filters}
                  sort={sort}
                  budgetYen={budgetYen}
                />
              ))}
            </>
          )}
        </>
      )}

    </section>
  );
}

function MarketLine({ file }: { file: PicksFile }) {
  return (
    <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text" aria-label="市場条件">
      直近1か月の優待銘柄中央値{" "}
      <span
        className={`tabular-nums ${file.marketRet1m === null ? "text-subtle" : file.marketRet1m > 0 ? "text-up" : file.marketRet1m < 0 ? "text-down" : "text-muted"}`}
      >
        {file.marketRet1m === null ? "—" : signedPct(file.marketRet1m)}
      </span>{" "}
      → 市場条件{" "}
      <span className={file.marketDown ? "font-medium text-up" : "font-medium text-muted"}>
        {file.marketDown ? "成立" : "不成立"}
      </span>
      <span className="block text-[11px] text-subtle">
        マイナスのときだけ B・C が成り立ちます（D は市場条件なし）
      </span>
    </p>
  );
}

function MonthBlock({
  month,
  todayIso,
  filters,
  sort,
  budgetYen,
}: {
  month: PickMonth;
  todayIso: string;
  filters: FilterId[];
  sort: SortKey;
  budgetYen: number | null;
}) {
  // 順位は既定の並び（items の並び）で固定する。
  const rows = useMemo(() => {
    const ctx = { lastCumDate: month.lastCumDate, todayIso, budgetYen };
    return rankRows(month.items, filters, (f, item) => matchFilter(f, item, ctx), sort, "rank", sortValue);
  }, [month, todayIso, filters, sort, budgetYen]);
  const { shown, rest, more } = usePaged(rows, `${filters.join(",")}|${sort}`);

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium text-text">
        {month.month}月権利
        <span className="ml-1 text-xs font-normal tabular-nums text-subtle">
          （権利付最終日 {formatMonthDay(month.lastCumDate)}、今が約{month.entryDays}営業日前）
        </span>
      </h3>
      {month.items.length === 0 ? (
        <p className="mt-1 text-xs text-muted">過去の成績がある銘柄はありません</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] tabular-nums text-subtle">
            成績あり {month.items.length} 社 → 表示 {rows.length} 社（ルール該当 {month.matched} 社）
          </p>
          {rows.length === 0 ? (
            <p className="mt-2 text-xs text-muted">条件に当てはまる銘柄はありません</p>
          ) : (
            <ol className="mt-1">
              {shown.map(({ item, rank }) => (
                <PickRow key={item.code} item={item} rank={rank} lastCumDate={month.lastCumDate} todayIso={todayIso} />
              ))}
            </ol>
          )}
          <MoreButton rest={rest} onMore={more} />
        </>
      )}
    </div>
  );
}

function PickRow({
  item,
  rank,
  lastCumDate,
  todayIso,
}: {
  item: PickItem;
  rank: number;
  lastCumDate: string;
  todayIso: string;
}) {
  const inside = earningsInside(item, lastCumDate, todayIso);
  return (
    <li className="grid grid-cols-[2.5rem_2.75rem_minmax(0,1fr)] gap-x-2 border-b border-border py-3 last:border-b-0">
      <span className="pt-2.5 text-right text-xs tabular-nums text-subtle">{rank}位</span>
      <a
        href={`https://finance.yahoo.co.jp/quote/${item.code}.T`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-10 w-11 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text active:opacity-80"
      >
        {item.code}
      </a>
      <span className="min-w-0">
        {item.detailUrl ? (
          <a
            href={item.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm text-text underline-offset-2 active:opacity-80"
          >
            {item.name}
          </a>
        ) : (
          <span className="block truncate text-sm text-text">{item.name}</span>
        )}
        <span className="mt-0.5 block text-xs tabular-nums text-muted">
          {item.win}/{item.n}勝・平均
          <span className={item.avg > 0 ? "text-up" : item.avg < 0 ? "text-down" : ""}>{signedPct(item.avg)}</span>
          ・最悪<span className={item.worst < 0 ? "text-down" : ""}>{signedPct(item.worst)}</span>
          {item.streak >= 2 ? `・${item.streak}連勝中` : ""}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted">
          100株 {manYen(item.invest)}
          {item.minInvest !== null && item.minInvest > item.invest * 1.05 ? `（優待は ${manYen(item.minInvest)}〜）` : ""}
          {item.aboveMa75 === null ? "" : item.aboveMa75 ? "・75日線の上" : "・75日線の下"}
          {item.nextEarningsDate ? (
            <span className={inside ? "text-warn" : ""}>
              ・決算 {formatMonthDay(item.nextEarningsDate)}
              {inside ? "（期間中）" : ""}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {item.rules.map((r) => (
            <Chip key={r} tone={r === "B" ? "up" : r === "C" ? "accent" : "neutral"}>
              {r}: {PICK_RULE_LABELS[r]}
            </Chip>
          ))}
        </span>
      </span>
    </li>
  );
}
