"use client";

import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import { ScorePill } from "./ScoreBadge";
import { WatchStar } from "./WatchStar";
import { STATUS_LABELS, initialReturnRate } from "@/lib/format";

/** "2026-10-15" → "10/15"（一覧の 2 行目を 1 行に収めるため年を省く） */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

export type IpoCardCompleteness = "full" | "partial" | "insufficient";

/**
 * 銘柄カード（一覧・スクリーナー・ホーム共通）。カード全体が詳細ページへのリンク。
 * @param ipo 銘柄データ
 * @param supplyScore 需給スコア（0〜100）
 * @param fundaScore ファンダスコア（0〜100）
 * @param watched ウォッチ中かどうか
 * @param onToggleWatch ウォッチ星タップ時のコールバック
 * @param completeness データ充足度。'insufficient' の場合はスコアピルを出さず、2 行目に「情報未取得」を表示する（省略時は 'full' 扱い）
 */
export function IpoCard({
  ipo,
  supplyScore,
  fundaScore,
  watched,
  onToggleWatch,
  completeness = "full",
}: {
  ipo: Ipo;
  supplyScore: number;
  fundaScore: number;
  watched: boolean;
  onToggleWatch: () => void;
  completeness?: IpoCardCompleteness;
}) {
  const returnRate = initialReturnRate(ipo);

  return (
    <Link
      href={`/ipo/${ipo.code}`}
      // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
      prefetch={false}
      className="flex min-h-16 items-center gap-3 border-b border-border py-3 active:opacity-80"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[11px] font-medium text-muted">
        {ipo.code}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium text-text">
            {ipo.name}
          </h3>
        </div>
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted">
          <span>{ipo.market}</span>
          <span>{STATUS_LABELS[ipo.status]}</span>
          <span>{shortDate(ipo.listingDate)} 上場</span>
          {completeness === "insufficient" && (
            <span className="text-warn">情報未取得</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {completeness !== "insufficient" && (
          <div className="hidden items-center gap-2 sm:flex">
            <ScorePill score={supplyScore} label="需給" />
            <ScorePill score={fundaScore} label="ファンダ" />
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] text-muted">初値比</p>
          <p className="whitespace-nowrap text-sm font-medium text-text">
            {returnRate === null
              ? "—"
              : `${returnRate > 0 ? "+" : ""}${returnRate.toFixed(1)}%`}
          </p>
        </div>
        <WatchStar active={watched} onToggle={onToggleWatch} />
      </div>
    </Link>
  );
}
