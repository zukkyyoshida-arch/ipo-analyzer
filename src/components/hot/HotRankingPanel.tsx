"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
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
  isSinceListingReturn,
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
 * ホームの「ピックアップ」→「セカンダリー」の中身（注目度ランキング＝いま熱い銘柄の全ランキング）。
 * hot.json（夜間のデータ更新で作る）を表示するだけで、株価の取得はしない。
 * 呼び名は「注目度」にとどめ、期待リターンを連想させる語（おすすめ・有望など）は使わない。
 * 過熱の注意は、設定したセカンダリーの型の注意ライン（初値倍率）を使う。
 * hot.json が無い・空・古い（基準日が7日以上前）ときは「更新待ち」を出す。
 * @param hot hot.json（無ければ null）
 * @param todayIso 日本時間の今日（ページが計算して渡す。サーバーとクライアントで同じ値になる）
 */
export function HotRankingPanel({ hot, todayIso }: { hot: HotFile | null; todayIso: string }) {
  const { profile } = useSecondaryProfile();

  const hasItems = hot !== null && hot.items.length > 0;
  const stale = hasItems && isHotStale(hot.asOf, todayIso);
  const ready = hasItems && !stale;
  const anyOverheated =
    ready && hot.items.some((item) => isOverheated(item.initialRatio, profile.overheatRatio));

  return (
    <div>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-medium text-text">注目度ランキング</h2>
          {ready ? (
            <span className="text-xs tabular-nums text-subtle">{formatMonthDay(hot.asOf)} 終値時点</span>
          ) : (
            <Chip tone="warn">更新待ち</Chip>
          )}
        </div>

        {ready ? (
          <>
            <p className="mt-0.5 text-xs tabular-nums text-subtle">
              上場1年以内・対象 {hot.universe} 銘柄
            </p>
            <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
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
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">
              次の終値データで集計すると、上場1年以内の銘柄を注目度の順にここへ表示します
            </p>
            {stale ? (
              <p className="mt-2 text-xs tabular-nums text-subtle">
                前回の集計: {formatDate(hot.asOf)} 終値時点
              </p>
            ) : null}
          </div>
        )}
      </section>

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
            上場から日が浅く5日前（20日前）の終値がまだ無い銘柄は、上場初日の始値からの騰落率で見て、その値に「上場来」と添えています。
          </p>
          <p>
            銘柄名の下のチップは、上場来高値の{Math.round(HOT_REASON_THRESHOLDS.highProx * 100)}
            %以上のときの「上場来高値圏」と、初値が注意ラインを超えたときの過熱注意です。数値の指標は行の下の帯に並べています。
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
  // sinceListing: 基準が上場初日の始値（上場来の騰落率）。本数の無い古いデータでは false（従来の表示）。
  const metrics: {
    label: (typeof METRIC_LABELS)[number];
    value: ReactNode;
    sinceListing?: boolean;
  }[] = [
    { label: "5日", value: <SignedRatio ratio={item.r5} />, sinceListing: isSinceListingReturn(item.bars, 5) },
    { label: "20日", value: <SignedRatio ratio={item.r20} />, sinceListing: isSinceListingReturn(item.bars, 20) },
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
              {/* スマホは見出しを「上場来」に差し替え、1280px は列見出しが固定なので値の後ろに添える */}
              <span className="text-[11px] text-muted lg:hidden">{m.sinceListing ? "上場来" : m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">
                {m.value}
                {m.sinceListing ? (
                  <span className="ml-1 hidden text-[11px] text-subtle lg:inline">上場来</span>
                ) : null}
              </span>
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
