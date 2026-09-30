"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
import { jstTodayIso } from "@/lib/date";
import { formatDate } from "@/lib/format";
import {
  formatMonthDay,
  formatTurnoverJa,
  formatVolRatio,
  isHotStale,
  isOverheated,
  type HotFile,
} from "@/lib/hot/file";
import {
  HOT_LISTING_WINDOW_DAYS,
  HOT_MIN_TURNOVER,
  HOT_REASON_THRESHOLDS,
  HOT_WEIGHTS,
  type HotItem,
} from "@/lib/hot/score";
import { SECONDARY_STYLE_LABELS, formatSignedPct } from "@/lib/secondary/profiles";
import { HOT_BACKTEST, HOT_CAUTION_NOTE, overheatNote } from "@/lib/hot/backtest";
import { HotChips, ScoreBar, SignedRatio } from "./HotParts";

// 行の格子。スマホは「順位・コード・銘柄・注目度」の下に指標の帯、1280px では指標を列に並べる。
const ROW_GRID =
  "grid grid-cols-[1rem_2.5rem_minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[1rem_2.5rem_minmax(0,1fr)_30rem_4.5rem]";

const METRIC_LABELS = ["5日", "20日", "出来高", "高値比", "売買代金"] as const;

/** スコアの内訳の表示（何を何割で見ているか）。 */
const WEIGHT_ROWS: { label: string; weight: number; note: string }[] = [
  { label: "5日騰落率", weight: HOT_WEIGHTS.r5, note: "5営業日前の終値から" },
  { label: "20日騰落率", weight: HOT_WEIGHTS.r20, note: "20営業日前の終値から" },
  { label: "出来高の増え方", weight: HOT_WEIGHTS.volRatio, note: "直近5日の平均 ÷ その前20日の平均" },
  { label: "上場来高値への近さ", weight: HOT_WEIGHTS.highProx, note: "終値 ÷ 上場来の高値" },
];

/**
 * /hot（注目度ランキング＝いま熱い銘柄の全ランキング）の本体。hot.json を表示するだけで株価の取得はしない。
 * 呼び名は「注目度」にとどめ、期待リターンを連想させる語（おすすめ・有望など）は使わない。
 * 過熱の注意は、設定したセカンダリーの型の注意ライン（初値倍率）を使う。
 * 静的生成のため「今日」はマウント後に日本時間で求め、基準日が古ければ「更新待ち」を出す。
 */
export function HotRankingClient({ hot }: { hot: HotFile | null }) {
  const { profile } = useSecondaryProfile();
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(jstTodayIso());
  }, []);

  const hasItems = hot !== null && hot.items.length > 0;
  const stale = hasItems && today !== null && isHotStale(hot.asOf, today);
  const anyOverheated =
    hasItems && hot.items.some((item) => isOverheated(item.initialRatio, profile.overheatRatio));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[22px] font-medium text-text">注目度ランキング</h1>
        {hasItems ? (
          <p className="mt-1 text-xs tabular-nums text-subtle">
            {formatMonthDay(hot.asOf)} 終値時点・対象 {hot.universe} 銘柄
          </p>
        ) : null}
        {stale ? (
          <p className="mt-2 text-xs text-warn">
            更新待ち: {formatDate(hot.asOf)} 終値で集計したランキングです
          </p>
        ) : null}
      </div>

      {!hasItems ? (
        <EmptyState
          title="次の終値データで集計すると、ランキングを表示します"
          description="上場1年以内の銘柄を、直近の値動きと出来高から注目度の順に並べます。"
        />
      ) : (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className={`${ROW_GRID} border-b border-border pb-2 text-xs text-muted`}>
            <span className="col-span-3">銘柄</span>
            <span className="hidden lg:col-start-4 lg:grid lg:grid-cols-5 lg:gap-1">
              {METRIC_LABELS.map((label) => (
                <span key={label} className="text-right">
                  {label}
                </span>
              ))}
            </span>
            <span className="col-start-4 text-right lg:col-start-5">注目度</span>
          </div>
          <ol>
            {hot.items.map((item, i) => (
              <HotRow key={item.code} rank={i + 1} item={item} overheatRatio={profile.overheatRatio} />
            ))}
          </ol>
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
            <p>{HOT_CAUTION_NOTE}</p>
            {anyOverheated ? <p>{overheatNote(profile.overheatRatio)}</p> : null}
            <p>判断材料であり売買推奨ではありません。</p>
          </div>
        </section>
      )}

      <details className="mt-4 rounded-xl border border-border bg-surface px-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block text-muted">▶</span>
            注目度の見方
          </span>
        </summary>
        <div className="space-y-3 pb-4 text-xs leading-relaxed text-muted">
          <p>
            上場から{HOT_LISTING_WINDOW_DAYS}日以内で、直近5日の平均売買代金が
            {(HOT_MIN_TURNOVER / 1e4).toLocaleString("ja-JP")}万円以上の銘柄を比べています。
          </p>
          <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
            {WEIGHT_ROWS.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-text">{row.label}</span>
                  <span className="block text-[11px] text-subtle">{row.note}</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-text">
                  {Math.round(row.weight * 100)}%
                </span>
              </li>
            ))}
          </ul>
          <p>
            4つの指標をそれぞれ対象銘柄の中での順位（0〜100）にして、上の割合で足したものが注目度です。上場から25営業日に満たない銘柄の出来高の増え方は中間の50として数えます。
          </p>
          <p>
            過去検証（{HOT_BACKTEST.period}の{HOT_BACKTEST.evalDays}日）では、毎日の上位10銘柄のうち20営業日後に上がったのは
            {HOT_BACKTEST.top10After20.upRatePct}%、中央値は{formatSignedPct(HOT_BACKTEST.top10After20.medianPct)}でした。平均は
            {formatSignedPct(HOT_BACKTEST.top10After20.meanPct)}ですが、大きく上がった少数の銘柄によるものです。−20%以下が
            {HOT_BACKTEST.top10After20.downOver20Pct}%、+20%以上が{HOT_BACKTEST.top10After20.upOver20Pct}%と値動きは大きめで、5営業日後までは上位とほかの銘柄に差は見られませんでした。
          </p>
          <p>
            チップは、5日で+{Math.round(HOT_REASON_THRESHOLDS.r5 * 100)}%以上・出来高
            {HOT_REASON_THRESHOLDS.volRatio}倍以上・上場来高値の{Math.round(HOT_REASON_THRESHOLDS.highProx * 100)}
            %以上・20日で+{Math.round(HOT_REASON_THRESHOLDS.r20 * 100)}%以上のときに付きます。
          </p>
          <div>
            <p>
              過熱注意は、初値が公開価格の{profile.overheatRatio.toFixed(1)}倍を超えた銘柄に付きます（セカンダリーの型の注意ライン）。
            </p>
            <Link
              href="/settings#secondary"
              prefetch={false}
              className="inline-flex min-h-11 items-center font-medium text-accent"
            >
              型を変える（いま: {SECONDARY_STYLE_LABELS[profile.style]}）→
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}

function HotRow({
  rank,
  item,
  overheatRatio,
}: {
  rank: number;
  item: HotItem;
  overheatRatio: number;
}) {
  const metrics: { label: (typeof METRIC_LABELS)[number]; value: ReactNode }[] = [
    { label: "5日", value: <SignedRatio ratio={item.r5} /> },
    { label: "20日", value: <SignedRatio ratio={item.r20} /> },
    { label: "出来高", value: formatVolRatio(item.volRatio) },
    { label: "高値比", value: `${Math.round(item.highProx * 100)}%` },
    { label: "売買代金", value: formatTurnoverJa(item.turnover5) },
  ];

  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/ipo/${item.code}`}
        // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
        prefetch={false}
        className={`${ROW_GRID} items-center py-3 active:opacity-80`}
      >
        <span className="col-start-1 row-start-1 text-center text-sm tabular-nums text-muted">{rank}</span>
        <span className="col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {item.code}
        </span>
        <span className="col-start-3 row-start-1 min-w-0">
          <span className="block truncate text-sm text-text">{item.name}</span>
          {item.listingDate ? (
            <span className="block text-[11px] tabular-nums text-subtle">
              上場 {formatDate(item.listingDate)}
            </span>
          ) : null}
          <HotChips item={item} overheatRatio={overheatRatio} className="mt-1" />
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-text">{item.score}</span>
          <ScoreBar score={item.score} className="mt-1.5 w-12" />
        </span>
        <span className="col-span-4 col-start-1 row-start-2 mt-2 grid grid-cols-5 gap-1 rounded-lg bg-surface-2 px-2 py-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:bg-transparent lg:p-0">
          {metrics.map((m) => (
            <span key={m.label} className="flex min-w-0 flex-col lg:items-end">
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
