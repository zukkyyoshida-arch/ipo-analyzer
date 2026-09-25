"use client";

import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import { ScorePill } from "./ScoreBadge";
import { WatchStar } from "./WatchStar";
import { Chip } from "./ui/Chip";
import {
  STATUS_LABELS,
  formatDate,
  formatYen,
  initialReturnRate,
} from "@/lib/format";

export type IpoCardCompleteness = "full" | "partial" | "insufficient";

/**
 * 銘柄カード（一覧・スクリーナー・ホーム共通）。カード全体が詳細ページへのリンク。
 * @param ipo 銘柄データ
 * @param supplyScore 需給スコア（0〜100）
 * @param fundaScore ファンダスコア（0〜100）
 * @param watched ウォッチ中かどうか
 * @param onToggleWatch ウォッチ星タップ時のコールバック
 * @param completeness データ充足度。'insufficient' の場合はスコアピルの代わりに「基本情報 未取得」チップを表示する（省略時は 'full' 扱い）
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
      className="block rounded-2xl border border-border bg-surface p-4 active:opacity-80"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Chip tone="accent">{STATUS_LABELS[ipo.status]}</Chip>
            <span className="text-xs text-muted">{ipo.code}</span>
            <span className="text-xs text-muted">{ipo.market}</span>
          </div>
          <h3 className="mt-1 truncate text-base font-bold text-text">
            {ipo.name}
          </h3>
          {ipo.theme.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {ipo.theme.slice(0, 3).map((t) => (
                <Chip key={t} tone="neutral">
                  {t}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
        <WatchStar active={watched} onToggle={onToggleWatch} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">上場日</dt>
          <dd className="font-medium text-text">
            {formatDate(ipo.listingDate)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">公開価格</dt>
          <dd className="font-medium text-text">
            {ipo.offeringPrice === null ? "—" : formatYen(ipo.offeringPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">初値比%</dt>
          <dd className="font-medium text-text">
            {returnRate === null
              ? "—"
              : `${returnRate > 0 ? "+" : ""}${returnRate.toFixed(1)}%`}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        {completeness === "insufficient" ? (
          <Chip tone="warn">基本情報 未取得</Chip>
        ) : (
          <>
            <ScorePill score={supplyScore} label="需給" />
            <ScorePill score={fundaScore} label="ファンダ" />
          </>
        )}
      </div>
    </Link>
  );
}
