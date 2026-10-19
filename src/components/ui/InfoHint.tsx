"use client";

import { useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";

/**
 * 見出し付近に置く小さな ⓘ ボタン。押すと補足・注意書きを BottomSheet で出す。
 * 免責や長い説明を本文から退避するために使う。
 * @param title シートの見出し（任意）
 * @param children シート本文
 * @param label ボタンの aria-label（既定「説明を見る」）
 */
export function InfoHint({
  title,
  children,
  label,
}: {
  title?: string;
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label ?? "説明を見る"}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 min-w-11 items-center justify-center align-middle text-muted"
      >
        <svg
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5" />
          <circle cx="10" cy="6.2" r="0.6" fill="currentColor" />
        </svg>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={title ?? "説明"}>
        <div className="space-y-2 pb-2 text-xs leading-relaxed text-muted">{children}</div>
      </BottomSheet>
    </>
  );
}
