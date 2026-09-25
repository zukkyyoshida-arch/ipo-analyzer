"use client";

import { useEffect, type ReactNode } from "react";

/**
 * モバイル用の下からのシート。背景タップ／Escapeで閉じる。開いている間はbodyスクロールをロックする。
 * @param open 表示状態
 * @param onClose 閉じる要求時のコールバック（背景タップ・Escape・閉じるボタン共通）
 * @param title シート見出し（任意）
 * @param children シート本文
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-safe"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        {title ? (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-text">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="flex min-h-11 min-w-11 items-center justify-center text-muted"
            >
              <svg
                viewBox="0 0 20 20"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
