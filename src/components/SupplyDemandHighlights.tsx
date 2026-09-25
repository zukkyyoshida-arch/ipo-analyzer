"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "@/lib/scoring/types";
import { selectSupplyDemandHighlights } from "@/lib/highlights";
import { ScorePill } from "./ScoreBadge";
import { WatchStar } from "./WatchStar";
import { STATUS_LABELS, STATUS_BADGE_CLASS, formatDate } from "@/lib/format";

// 「需給タイト度 上位」セクション。中立表現のみ。
// bb_open / priced / 上場14日以内の upcoming を需給スコア降順で上位3件表示する。
// クライアントのローカル日付を使うため、ハイドレーション不整合を避けてマウント後に描画する。

/** ローカル日付を YYYY-MM-DD で返す。 */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function SupplyDemandHighlights({
  ipos,
  settings,
  watched,
  onToggleWatch,
  className = "",
}: {
  ipos: Ipo[];
  settings: ScoreSettings;
  watched: (code: string) => boolean;
  onToggleWatch: (code: string) => void;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const highlights = useMemo(() => {
    if (!mounted) return [];
    return selectSupplyDemandHighlights(ipos, settings, localToday(), 3);
  }, [mounted, ipos, settings]);

  if (!mounted || highlights.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-slate-800">需給タイト度 上位</h2>
        <span className="text-[11px] text-slate-400">
          需給スコアの機械的な上位（推奨ではありません）
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {highlights.map(({ ipo, supplyScore }) => (
          <Link
            key={ipo.code}
            href={`/ipo/${ipo.code}`}
            className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-1">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE_CLASS[ipo.status]}`}
              >
                {STATUS_LABELS[ipo.status]}
              </span>
              <WatchStar
                active={watched(ipo.code)}
                onToggle={() => onToggleWatch(ipo.code)}
              />
            </div>
            <h3 className="mt-1 truncate text-sm font-bold text-slate-900">
              {ipo.name}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              上場 {formatDate(ipo.listingDate)}
            </p>
            <div className="mt-2">
              <ScorePill score={supplyScore} label="需給" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
