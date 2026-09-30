"use client";

import Link from "next/link";
import { DetailButton } from "@/components/analytics/DetailButton";
import { Chip } from "@/components/ui/Chip";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
import {
  HOME_HOT_LIMIT,
  formatMonthDay,
  isHotStale,
  isOverheated,
  type HotFile,
} from "@/lib/hot/file";
import { HOT_CAUTION_NOTE, overheatNote } from "@/lib/hot/backtest";
import { HotChips, ScoreBar, SignedRatio } from "./HotParts";

/**
 * ホームの「注目度ランキング」（いま熱い銘柄）。上場1年以内の銘柄を注目度（直近の値動きと出来高）の順に上位5件。
 * データが無い・空のときは出さない。基準日が古い（7日以上前）ときは「更新待ち」にする。
 * 呼び名は「注目度」にとどめ、期待リターンを連想させる語（おすすめ・有望など）は使わない。
 * 下の注記は過去検証（src/lib/hot/backtest.ts）の事実で、常に出す。
 * @param hot hot.json（ページ側で上位に絞って渡してよい）
 * @param todayIso 日本時間の今日（ページが計算して渡す）
 */
export function HotStocksCard({ hot, todayIso }: { hot: HotFile | null; todayIso: string }) {
  const { profile } = useSecondaryProfile();
  if (!hot || hot.items.length === 0) return null;

  const stale = isHotStale(hot.asOf, todayIso);
  const items = hot.items.slice(0, HOME_HOT_LIMIT);
  const anyOverheated = items.some((item) => isOverheated(item.initialRatio, profile.overheatRatio));

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">注目度ランキング</h2>
        {stale ? <Chip tone="warn">更新待ち</Chip> : <span className="text-xs text-muted">注目度</span>}
      </div>
      <p className="mt-0.5 text-xs tabular-nums text-subtle">{formatMonthDay(hot.asOf)} 終値時点</p>

      {stale ? (
        <p className="py-6 text-center text-sm text-muted">
          次の終値データで集計すると、上位{HOME_HOT_LIMIT}銘柄をここに表示します
        </p>
      ) : (
        <ol className="mt-1">
          {items.map((item, i) => (
            <li key={item.code} className="border-b border-border last:border-b-0">
              <Link
                href={`/ipo/${item.code}`}
                // 銘柄リンクは先読みしない（タップ時に取得する）。
                prefetch={false}
                className="flex min-h-16 items-center gap-3 py-2.5 active:opacity-80"
              >
                <span className="w-4 shrink-0 text-center text-sm tabular-nums text-muted">{i + 1}</span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
                  {item.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{item.name}</span>
                  <HotChips item={item} overheatRatio={profile.overheatRatio} className="mt-1" />
                </span>
                <span className="flex min-w-16 shrink-0 flex-col items-end">
                  <span className="text-base font-medium leading-none tabular-nums text-text">
                    {item.score}
                  </span>
                  <ScoreBar score={item.score} className="mt-1.5 w-12" />
                  <span className="mt-1.5 whitespace-nowrap text-[11px] text-muted">
                    5日 <SignedRatio ratio={item.r5} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {stale ? null : (
        <div className="mt-1 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
          <p>{HOT_CAUTION_NOTE}</p>
          {anyOverheated ? <p>{overheatNote(profile.overheatRatio)}</p> : null}
        </div>
      )}
      <DetailButton href="/hot" label="もっと見る" />
    </section>
  );
}
