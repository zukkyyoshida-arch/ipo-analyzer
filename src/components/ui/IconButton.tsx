"use client";

import type { ReactNode } from "react";

/**
 * アイコンのみのタップ領域44px以上のボタン。
 * @param onClick クリックハンドラ
 * @param ariaLabel アクセシブルラベル（必須。アイコンのみのため）
 * @param children アイコン要素（svg等）
 * @param className 追加クラス
 */
export function IconButton({
  onClick,
  ariaLabel,
  children,
  className = "",
}: {
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-full text-text active:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}
