"use client";

import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import { ScorePill } from "./ScoreBadge";
import { WatchStar } from "./WatchStar";
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  formatDate,
  formatOku,
} from "@/lib/format";

export function IpoCard({
  ipo,
  supplyScore,
  fundaScore,
  watched,
  onToggleWatch,
}: {
  ipo: Ipo;
  supplyScore: number;
  fundaScore: number;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  return (
    <Link
      href={`/ipo/${ipo.code}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE_CLASS[ipo.status]}`}
            >
              {STATUS_LABELS[ipo.status]}
            </span>
            <span className="text-xs text-slate-400">{ipo.code}</span>
          </div>
          <h3 className="mt-1 truncate text-base font-bold text-slate-900">
            {ipo.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {ipo.market}・{ipo.sector}
          </p>
        </div>
        <WatchStar active={watched} onToggle={onToggleWatch} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ipo.theme.map((t) => (
          <span
            key={t}
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
          >
            {t}
          </span>
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-400">上場日</dt>
          <dd className="font-medium text-slate-700">
            {formatDate(ipo.listingDate)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">吸収金額</dt>
          <dd className="font-medium text-slate-700">
            {formatOku(ipo.absorptionAmount)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">主幹事</dt>
          <dd className="truncate font-medium text-slate-700">
            {ipo.leadUnderwriter}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
        <ScorePill score={supplyScore} label="需給" />
        <ScorePill score={fundaScore} label="ファンダ" />
      </div>
    </Link>
  );
}
