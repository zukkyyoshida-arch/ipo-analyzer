"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "@/lib/scoring/types";
import { selectSupplyDemandHighlights } from "@/lib/highlights";
import { WatchStar } from "./WatchStar";
import { STATUS_LABELS, formatDate } from "@/lib/format";

// 「需給タイト度 上位」ランキング（リスト様式）。中立表現のみ。
// bb_open / priced / 上場14日以内の upcoming を需給スコア降順で上位3件表示する。
//
// 「今日」はクライアントの Date.now を副作用で読まず、呼び出し側（page.tsx が
// サーバーで計算した todayIso）から props で受け取る。これによりハイドレーション
// 不一致も react-hooks/set-state-in-effect も発生しない。

export function SupplyDemandHighlights({
  ipos,
  settings,
  todayIso,
  watched,
  onToggleWatch,
  className = "",
}: {
  ipos: Ipo[];
  settings: ScoreSettings;
  /** 「今日」の日付（YYYY-MM-DD）。サーバー側で計算した値を渡す。 */
  todayIso: string;
  watched: (code: string) => boolean;
  onToggleWatch: (code: string) => void;
  className?: string;
}) {
  const highlights = useMemo(() => {
    return selectSupplyDemandHighlights(ipos, settings, todayIso, 3);
  }, [ipos, settings, todayIso]);

  if (highlights.length === 0) return null;

  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text">需給タイト度 上位</h2>
        <span className="text-xs text-muted">需給スコア</span>
      </div>
      <ol className="mt-2">
        {highlights.map(({ ipo, supplyScore }, i) => (
          <li key={ipo.code} className="border-b border-border last:border-b-0">
            <Link
              href={`/ipo/${ipo.code}`}
              className="flex min-h-16 items-center gap-3 py-2 active:opacity-80"
            >
              <span className="w-4 shrink-0 text-center text-sm tabular-nums text-muted">{i + 1}</span>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
                {ipo.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{ipo.name}</span>
                <span className="block truncate text-xs text-muted">
                  {STATUS_LABELS[ipo.status]} · 上場 {ipo.listingDate ? formatDate(ipo.listingDate) : "未定"}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-text">
                {supplyScore.toFixed(0)}
              </span>
              <WatchStar
                active={watched(ipo.code)}
                onToggle={() => onToggleWatch(ipo.code)}
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
