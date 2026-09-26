"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "@/lib/scoring/types";
import { selectSupplyDemandHighlights } from "@/lib/highlights";
import { ScorePill } from "./ScoreBadge";
import { WatchStar } from "./WatchStar";
import { Card } from "./ui/Card";
import { Chip } from "./ui/Chip";
import { STATUS_LABELS, formatDate } from "@/lib/format";

// 「需給タイト度 上位」セクション。中立表現のみ。
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
    <section className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text">需給タイト度 上位</h2>
        <span className="text-[11px] text-muted">
          需給スコアの機械的な上位（参考情報）
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {highlights.map(({ ipo, supplyScore }) => (
          <Link key={ipo.code} href={`/ipo/${ipo.code}`} className="block">
            <Card className="p-3 active:opacity-80">
              <div className="flex items-start justify-between gap-1">
                <Chip tone="accent">{STATUS_LABELS[ipo.status]}</Chip>
                <WatchStar
                  active={watched(ipo.code)}
                  onToggle={() => onToggleWatch(ipo.code)}
                />
              </div>
              <h3 className="mt-1 truncate text-sm font-bold text-text">
                {ipo.name}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">
                上場 {formatDate(ipo.listingDate)}
              </p>
              <div className="mt-2">
                <ScorePill score={supplyScore} label="需給" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
