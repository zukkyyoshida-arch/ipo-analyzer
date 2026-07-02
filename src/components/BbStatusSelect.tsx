"use client";

import type { BbStatus } from "@/types/broker";
import { BB_STATUS_LABELS, BB_STATUS_ORDER } from "@/types/broker";

const STATUS_CLASS: Record<BbStatus, string> = {
  none: "text-slate-500",
  planned: "text-blue-700",
  applied: "text-indigo-700",
  won: "text-emerald-700",
  waitlist: "text-amber-700",
  lost: "text-slate-500",
  declined: "text-slate-500",
  purchased: "text-emerald-800",
};

// BB 申込ステータスのセレクタ。
export function BbStatusSelect({
  value,
  onChange,
}: {
  value: BbStatus;
  onChange: (status: BbStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BbStatus)}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium focus:border-slate-400 focus:outline-none ${STATUS_CLASS[value]}`}
      aria-label="BB申込ステータス"
    >
      {BB_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {BB_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
