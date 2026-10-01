"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { YutaiGuide } from "@/components/picks/YutaiGuide";
import { formatMonthDay } from "@/lib/hot/file";
import { rankYutai, sortYutai, YUTAI_SORT_OPTIONS, type YutaiSortKey, type YutaiPick, type YutaiReason, type YutaiTier } from "@/lib/picks/yutai";
import { isYutaiStale, monthLabel, parseYutaiMonthFile } from "@/lib/yutai/file";
import { YUTAI_SOURCE, prevMonthOf, yutaiMonthFileUrl, type YutaiCandle, type YutaiMonthFile } from "@/lib/yutai/types";

// 行の格子。スマホは「順位・コード・社名・陽線数」の下に数字の帯、1280px では数字を列に並べる
// （中長期セカンダリと同じ組み方）。
const ROW_GRID =
  "grid grid-cols-[1rem_2.75rem_minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[1rem_2.75rem_minmax(0,1fr)_34rem_5rem]";

const METRIC_LABELS = ["前月平均", "最大上昇 平均", "前年 安値→高値", "株価位置", "最低投資"] as const;

const DOT_CLASS: Record<YutaiTier, string> = {
  strong: "bg-up",
  good: "bg-warn",
  other: "bg-border",
};

const TIER_LABEL: Record<YutaiTier, string> = {
  strong: "強",
  good: "良",
  other: "その他",
};

const REASON_TONE = { good: "up", warn: "warn", bad: "down" } as const;

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: monthLabel(i + 1),
}));

function signedPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function manYen(yen: number | null): string {
  if (yen === null) return "—";
  return `${Math.round(yen / 1000) / 10}万円`;
}

function posLabel(pos: number | null): string {
  if (pos === null) return "—";
  const p = Math.round(pos * 100);
  return pos >= 0.85 ? `高値圏 ${p}%` : pos <= 0.15 ? `安値圏 ${p}%` : `${p}%`;
}

/** 過去 10 年の月足を、古い→新しい順の 10 枡にする（足りない古い側は空の枡）。 */
function candleCells(candles: YutaiCandle[]): (YutaiCandle | null)[] {
  const recent = candles.slice(-10);
  return [...Array<null>(10 - recent.length).fill(null), ...recent];
}

/** 月ごとの取得結果。"missing" は 404・形の崩れ・通信失敗（月を選び直すと取り直す）。 */
type MonthEntry = YutaiMonthFile | "missing";

/**
 * ホームの「ピックアップ」→「優待」。株主優待の先回り買い候補の一覧。
 * 権利確定月ごとに、前月の月足が過去 10 年で陽線だった本数の多い銘柄を並べる（並べ方は lib/picks/yutai.ts）。
 * データは月別の静的ファイル（/data/yutai/<M>.json）をブラウザが直接取る。取得済みの月は持ち回って再取得しない。
 * サーバー描画では「読み込み中…」を出し、マウント後に取得する（ハイドレーションを揃えるため）。
 * @param initialMonth 最初に開く権利確定月（1〜12）
 * @param todayIso 日本時間の今日
 */
export function YutaiPanel({ initialMonth, todayIso }: { initialMonth: number; todayIso: string }) {
  const startMonth = initialMonth >= 1 && initialMonth <= 12 ? initialMonth : 1;
  const [month, setMonth] = useState<number>(startMonth);
  const [cache, setCache] = useState<Record<number, MonthEntry>>({});
  const inflight = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (cache[month] !== undefined || inflight.current.has(month)) return;
    inflight.current.add(month);
    const target = month;
    fetch(yutaiMonthFileUrl(target))
      .then(async (res) => (res.ok ? parseYutaiMonthFile(await res.json()) : null))
      .catch(() => null)
      .then((file) => {
        inflight.current.delete(target);
        setCache((prev) => ({ ...prev, [target]: file ?? "missing" }));
      });
  }, [month, cache]);

  const entry = cache[month];
  const data = entry && entry !== "missing" ? entry : null;
  const asOf = data?.asOf ?? null;
  const loading = entry === undefined;

  const selectMonth = (m: number) => {
    // 取得できなかった月は、選び直したときに取り直す。
    if (cache[m] === "missing") {
      setCache((prev) => {
        const next = { ...prev };
        delete next[m];
        return next;
      });
    }
    setMonth(m);
  };

  // 予算（万円）。空なら絞らない。ブラウザに覚えておく。
  const [budgetText, setBudgetText] = useLocalStorage<string>("yutai.budgetMan", "");
  const budgetMan = Number(budgetText);
  const budgetYen = budgetText.trim() !== "" && Number.isFinite(budgetMan) && budgetMan > 0 ? budgetMan * 10_000 : null;
  const ranked = useMemo(() => rankYutai(data), [data]);
  // 最低投資金額が分からない銘柄は、予算を指定していても残す。
  const [sortText, setSortText] = useLocalStorage<string>("yutai.sortKey", "wins");
  const sortKey: YutaiSortKey = YUTAI_SORT_OPTIONS.some((o) => o.value === sortText)
    ? (sortText as YutaiSortKey)
    : "wins";
  const picks = useMemo(
    () =>
      sortYutai(
        budgetYen === null
          ? ranked
          : ranked.filter((p) => p.item.minInvest === null || p.item.minInvest <= budgetYen),
        sortKey,
      ),
    [ranked, budgetYen, sortKey],
  );
  const stale = asOf !== null && isYutaiStale(asOf, todayIso);
  const prev = prevMonthOf(month);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">優待（先回り買い）</h2>

      <Segmented
        className="mt-2"
        options={MONTH_OPTIONS}
        value={String(month)}
        onChange={(v) => selectMonth(Number(v))}
      />
      <p className="mt-2 text-xs tabular-nums text-subtle">
        {monthLabel(month)}権利 → {monthLabel(prev)}の月足を見る
        {ranked.length > 0 ? ` · 対象 ${ranked.length} 社` : ""}
        {asOf ? ` · 一覧は ${formatMonthDay(asOf)} 取得` : ""}
      </p>
      {ranked.length > 0 ? (
        <p className="mt-1 text-xs text-subtle">
          買いは {monthLabel(prev)}初 → 売りは {monthLabel(month)}の権利付最終日まで
        </p>
      ) : null}
      {stale && asOf ? (
        <p className="mt-1 text-xs text-warn">一覧が古い（{formatMonthDay(asOf)} 取得）</p>
      ) : null}

      {ranked.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            予算
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              placeholder="指定なし"
              className="h-9 w-24 rounded-lg border border-border bg-surface-2 px-2 text-right text-sm tabular-nums text-text"
            />
            万円
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            並び順
            <select
              value={sortKey}
              onChange={(e) => setSortText(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text"
            >
              {YUTAI_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {budgetYen !== null ? (
            <span className="text-xs tabular-nums text-subtle">
              予算 {budgetMan}万円以内 {picks.length}社
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">読み込み中…</p>
      ) : ranked.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="更新待ち" description="夜間のデータ更新で作られます" />
        </div>
      ) : (
        <PickList picks={picks} />
      )}

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-muted">
        <p>
          陽線＝前月の月足で終値&gt;始値。過去の傾向で、将来の値動きを示すものではありません。2016〜25
          年の検証では前月の陽線数に予測力は確認できていません（3 月権利・9 月権利、CI が 0
          をまたぐ）。業績・IR と株価位置を併せて確認し、分散して使うのが前提です。
        </p>
        <p>
          前年 安値→高値＝前年の前月の月足で、安値から高値までの上昇率（月内のどこかで買えて高値で売れた場合の最大幅で、実際に取れる幅ではありません）。並び順「勝率×前年の値幅」は、10
          年の勝率にこの上昇率を掛けた点数の高い順です。
        </p>
        <p>
          出典:{" "}
          <a href={YUTAI_SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline">
            {YUTAI_SOURCE.name}
          </a>
          ／株価: Yahoo Finance
        </p>
      </div>

      <details className="mt-3 border-t border-border">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-text marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block text-muted">▶</span>
            先回り買いとは
          </span>
        </summary>
        <YutaiGuide />
        <div className="mt-2 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-muted">
          <h3 className="text-sm font-medium text-text">売買のルール</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>買い: 前月の月初。</li>
            <li>売り: 権利付最終日（権利確定日の 2 営業日前）まで。</li>
            <li>目標は +10%。+8% まで上がったら +5% に逆指値を置いて利益を守る。</li>
            <li>決算発表をまたがない（直前の進捗がよければ例外）。</li>
            <li>1 銘柄に集中せず 4〜5 銘柄に分散する。</li>
            <li>株価位置が高値圏の銘柄・今期業績の悪い銘柄は避ける。</li>
          </ul>
        </div>
      </details>
    </section>
  );
}

/** 表示する銘柄の一覧（強・良は常に、その他は折りたたみ）。 */
function PickList({ picks }: { picks: YutaiPick[] }) {
  const top = picks.filter((p) => p.tier !== "other");
  const others = picks.filter((p) => p.tier === "other");
  return (
    <>
          <ListHeader />
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {picks.length === 0 ? "予算内の銘柄はありません" : "直近5年・10年で陽線の多い銘柄はありません"}
            </p>
          ) : (
            <ol>
              {top.map((pick, i) => (
                <YutaiRow key={pick.item.code} rank={i + 1} pick={pick} />
              ))}
            </ol>
          )}
          {others.length > 0 ? (
            <details className="mt-2 border-t border-border">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-text marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block text-muted">▶</span>
                  ほかの {others.length} 社を見る
                </span>
              </summary>
              <ol>
                {others.map((pick, i) => (
                  <YutaiRow key={pick.item.code} rank={top.length + i + 1} pick={pick} />
                ))}
              </ol>
            </details>
          ) : null}
    </>
  );
}

function ListHeader() {
  return (
    <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
      <span className="col-span-3">銘柄（過去 10 年の月足）</span>
      <span className="hidden lg:col-start-4 lg:grid lg:grid-cols-5 lg:gap-1">
        {METRIC_LABELS.map((label) => (
          <span key={label} className="text-right">
            {label}
          </span>
        ))}
      </span>
      <span className="col-start-4 text-right lg:col-start-5">直近5年</span>
    </div>
  );
}

/** 過去 10 年の月足の枡（緑=陽線、赤=陰線、枠色=データ無し）。古い→新しい順。 */
function CandleCells({ candles }: { candles: YutaiCandle[] }) {
  return (
    <span className="flex gap-0.5" role="list" aria-label="過去10年の前月の月足">
      {candleCells(candles).map((c, i) => {
        if (!c) {
          return <span key={i} role="listitem" aria-label="データなし" className="h-2.5 w-2.5 rounded-sm bg-border" />;
        }
        const ret = c.close / c.open - 1;
        const up = c.close > c.open;
        return (
          <span
            key={i}
            role="listitem"
            title={`${c.year}年 ${signedPct(ret)}`}
            aria-label={`${c.year}年 ${up ? "陽線" : "陰線"} ${signedPct(ret)}`}
            className={`h-2.5 w-2.5 rounded-sm ${up ? "bg-up" : "bg-down"}`}
          />
        );
      })}
    </span>
  );
}

function YutaiRow({ rank, pick }: { rank: number; pick: YutaiPick }) {
  const { item } = pick;
  const lastYear = item.candles[item.candles.length - 1]?.year;
  const metrics: { label: (typeof METRIC_LABELS)[number]; value: string; title?: string }[] = [
    { label: "前月平均", value: item.avgRet10 !== null ? signedPct(item.avgRet10) : "—" },
    { label: "最大上昇 平均", value: item.avgHighRet10 !== null ? signedPct(item.avgHighRet10) : "—" },
    {
      label: "前年 安値→高値",
      value: pick.lastRange !== null ? signedPct(pick.lastRange) : "—",
      title: lastYear !== undefined ? `${lastYear}年の月足 安値→高値` : undefined,
    },
    { label: "株価位置", value: posLabel(pick.pricePos12) },
    { label: "最低投資", value: item.minInvest === null ? "投資額不明" : manYen(item.minInvest) },
  ];

  return (
    <li className="border-b border-border last:border-b-0">
      <div className={`${ROW_GRID} items-center py-3`}>
        <span
          className={`col-start-1 row-start-1 inline-block h-2 w-2 justify-self-center rounded-full ${DOT_CLASS[pick.tier]}`}
          title={`${TIER_LABEL[pick.tier]}（順位 ${rank}）`}
          aria-label={`${TIER_LABEL[pick.tier]}、順位 ${rank}`}
        />
        <a
          href={`https://finance.yahoo.co.jp/quote/${item.code}.T`}
          target="_blank"
          rel="noopener noreferrer"
          className="col-start-2 row-start-1 flex h-10 w-11 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text active:opacity-80"
        >
          {item.code}
        </a>
        <span className="col-start-3 row-start-1 min-w-0">
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
          <span className="mt-1 flex items-center gap-3">
            <CandleCells candles={item.candles} />
            <a
              href={`https://kabutan.jp/stock/finance?code=${item.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-accent underline-offset-2 active:opacity-80"
            >
              業績
            </a>
          </span>
          {pick.reasons.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {pick.reasons.map((r: YutaiReason) => (
                <Chip key={r.id} tone={REASON_TONE[r.tone]}>
                  {r.text}
                </Chip>
              ))}
            </span>
          ) : null}
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-text">
            {item.n5 > 0 ? `${item.up5}/${item.n5}` : "—"}
          </span>
          <span className="mt-1 text-[11px] tabular-nums text-subtle">
            {item.up10}/{item.n10} {Math.round(pick.upRate10 * 100)}%
          </span>
        </span>
        <span className="col-span-4 col-start-1 row-start-2 mt-2 grid grid-cols-3 gap-x-1 gap-y-1.5 lg:grid-cols-5 rounded-lg bg-surface-2 px-2 py-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:bg-transparent lg:p-0">
          {metrics.map((m) => (
            <span key={m.label} title={m.title} className="flex min-w-0 flex-col lg:items-end">
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
            </span>
          ))}
        </span>
      </div>
    </li>
  );
}
