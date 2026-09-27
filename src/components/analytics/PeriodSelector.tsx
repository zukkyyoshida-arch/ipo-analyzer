"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PERIOD_OPTIONS, periodLabel, type DateWindow, type PeriodKey } from "@/lib/analytics";
import { formatDate } from "@/lib/format";

/** 右上の期間セレクタ。上段に日付範囲、下段に「過去 90 日間 ▾」。タップでボトムシート。 */
export function PeriodSelector({
  value,
  range,
  onChange,
}: {
  value: PeriodKey;
  range: DateWindow;
  onChange: (v: PeriodKey) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex min-h-11 flex-col items-end justify-center text-right active:opacity-80"
      >
        <span className="text-xs tabular-nums text-subtle">
          {formatDate(range.start)} – {formatDate(range.end)}
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-text">
          {periodLabel(value)}
          <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M5.5 7.5L10 12l4.5-4.5z" />
          </svg>
        </span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="期間">
        <ul>
          {PERIOD_OPTIONS.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  aria-pressed={active}
                  className={`flex h-12 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${
                    active ? "bg-surface-2 font-medium text-text" : "text-text"
                  }`}
                >
                  {o.label}
                  {active ? (
                    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M4 10.5l4 4 8-9" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </>
  );
}
