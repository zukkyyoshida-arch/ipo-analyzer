import Link from "next/link";
import type { ReactNode } from "react";
import type { Ipo } from "@/types/ipo";
import { WatchStar } from "@/components/WatchStar";
import { DetailButton } from "./DetailButton";

export interface RankingItem {
  ipo: Ipo;
  /** 2 行目（市場・日付など）。 */
  sub: string;
  /** 右端の数値。 */
  value: ReactNode;
}

/** 「上位のコンテンツ」風ランキング。順位→コードバッジ→銘柄名/補足→右端に数値。 */
export function RankingList({
  title,
  column,
  items,
  empty,
  detailHref,
  watched,
  onToggleWatch,
  className = "",
}: {
  title: string;
  column: string;
  items: RankingItem[];
  empty: string;
  detailHref?: string;
  watched?: (code: string) => boolean;
  onToggleWatch?: (code: string) => void;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text">{title}</h2>
        <span className="text-xs text-muted">{column}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ol className="mt-2">
          {items.map((item, i) => (
            <li key={item.ipo.code} className="border-b border-border last:border-b-0">
              <Link
                href={`/ipo/${item.ipo.code}`}
                className="flex min-h-16 items-center gap-3 py-2 active:opacity-80"
              >
                <span className="w-4 shrink-0 text-center text-sm tabular-nums text-muted">{i + 1}</span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
                  {item.ipo.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{item.ipo.name}</span>
                  <span className="block truncate text-xs text-muted">{item.sub}</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-text">{item.value}</span>
                {watched && onToggleWatch ? (
                  <WatchStar
                    active={watched(item.ipo.code)}
                    onToggle={() => onToggleWatch(item.ipo.code)}
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {detailHref ? <DetailButton href={detailHref} /> : null}
    </section>
  );
}
