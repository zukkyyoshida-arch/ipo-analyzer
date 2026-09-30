"use client";

import { useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { Segmented } from "@/components/ui/Segmented";
import { formatMonthDay } from "@/lib/hot/file";
import { formatJstDateTime } from "@/lib/date";
import { formatHoldingDelta } from "@/lib/holdings/file";
import { HOLDINGS_ATTRIBUTION } from "@/lib/holdings/types";
import {
  holdingRatioText,
  HOLDINGS_METHOD_HALF_LIFE_DAYS,
  type HoldingsMethodPick,
  type HoldingsMethodResult,
  type HoldingsWindow,
} from "@/lib/picks/holdings";

// 行の格子。スマホは「順位・コード・銘柄・保有割合」、1280px も同じ 4 列（BB・短期セカンダリと同じ組み方）。
const ROW_GRID = "grid grid-cols-[1rem_2.5rem_minmax(0,1fr)_auto] gap-x-3";

const WINDOW_OPTIONS: { value: HoldingsWindow; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "week", label: "直近 1 週間" },
];

/**
 * ホームの「ピックアップ」→「大量保有」。大量保有報告書の「新規 5% 超」「保有割合の増加」を銘柄ごとに並べる。
 * 判定は lib/picks/holdings.ts（pickHoldingsMethod）でサーバーが済ませ、ここは「今日／直近 1 週間」の切替と表示だけ。
 * @param today 今日の提出の結果
 * @param week 直近 1 週間の提出の結果
 */
export function HoldingsPanel({ today, week }: { today: HoldingsMethodResult; week: HoldingsMethodResult }) {
  const [span, setSpan] = useState<HoldingsWindow>("today");
  const result = span === "today" ? today : week;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">大量保有の新規・増加</h2>
        {result.intradayFetchedAt ? (
          <span className="text-xs tabular-nums text-subtle">{formatJstDateTime(result.intradayFetchedAt).slice(5)} 時点</span>
        ) : result.coveredThrough ? (
          <span className="text-xs tabular-nums text-subtle">{formatMonthDay(result.coveredThrough)}提出分まで</span>
        ) : null}
      </div>
      <Segmented options={WINDOW_OPTIONS} value={span} onChange={setSpan} className="mt-2" />
      {span === "today" ? (
        <p className="mt-2 text-[11px] text-subtle">今日の提出は平日 9〜17 時に毎時更新しています（EDINET）。</p>
      ) : null}

      {result.stale ? (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          大量保有報告書のデータが更新待ちです。表示は取得済みの分だけです。
        </p>
      ) : null}

      {result.picks.length === 0 ? (
        span === "today" ? (
          <div className="py-8 text-center text-sm text-muted">
            <p>今日は該当なし。</p>
            <button
              type="button"
              onClick={() => setSpan("week")}
              className="mt-2 min-h-11 text-sm font-medium text-accent active:opacity-80"
            >
              直近 1 週間へ（{week.picks.length} 銘柄）
            </button>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted">直近 1 週間に新規・増加の報告はありません</p>
        )
      ) : (
        <>
          <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
            <span className="col-span-3">銘柄・提出者</span>
            <span className="text-right">保有割合</span>
          </div>
          <ol>
            {result.picks.map((pick) => (
              <HoldingsRow key={pick.code} pick={pick} />
            ))}
          </ol>
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
        <p>
          対象は大量保有報告書の新規 5% 超と、変更報告書で保有割合が増えたものだけです（減少・5% 割れ・上場時の報告は出しません）。
          並びは新規・増加の幅・保有目的（純投資・提携など）の点を、提出日から {HOLDINGS_METHOD_HALF_LIFE_DAYS} 日で半分になるよう減らして足した順です。
        </p>
        <p>決算進捗（1Q 30%・2Q 60%・3Q 80% 以上）での絞り込みは未対応です。</p>
        <p>報告は義務発生から最大 5 営業日遅れて出ます。判断材料であり売買推奨ではありません。</p>
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

function HoldingsRow({ pick }: { pick: HoldingsMethodPick }) {
  const { latest } = pick;
  const extra = pick.filings.length - 1;
  return (
    <li className="border-b border-border last:border-b-0">
      <Link href={`/ipo/${pick.code}`} prefetch={false} className={`${ROW_GRID} items-center py-3 active:opacity-80`}>
        <span className="text-center text-sm tabular-nums text-muted">{pick.rank}</span>
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
          {pick.reasons.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {pick.reasons.map((r) => (
                <Chip key={r} tone="up">
                  {r}
                </Chip>
              ))}
            </span>
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
