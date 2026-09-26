"use client";

import type { BbStatus } from "@/types/broker";
import { BB_STATUS_LABELS, BB_STATUS_ORDER } from "@/types/broker";

const STATUS_CLASS: Record<BbStatus, string> = {
  none: "text-muted",
  planned: "text-accent-2",
  applied: "text-accent-2",
  won: "text-up",
  waitlist: "text-warn",
  lost: "text-muted",
  declined: "text-muted",
  purchased: "text-up",
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
      className={`min-h-11 rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm font-medium focus:outline-none ${STATUS_CLASS[value]}`}
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
