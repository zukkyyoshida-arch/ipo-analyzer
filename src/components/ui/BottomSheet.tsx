"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 開く前のフォーカス位置を保存し、閉じたら復帰させる。
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // ダイアログ内の最初のフォーカス可能要素（無ければダイアログ自体）へフォーカスする。
    const dialog = dialogRef.current;
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialog).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      // 簡易フォーカストラップ: ダイアログ内の先頭/末尾でTabをwrapさせ、
      // 背後のコンテンツへフォーカスが漏れないようにする。
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-safe outline-none"
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
