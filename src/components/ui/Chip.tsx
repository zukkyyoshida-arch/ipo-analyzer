import type { ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "up" | "down" | "warn" | "selected";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-surface-2 text-accent",
  up: "bg-surface-2 text-up",
  down: "bg-surface-2 text-down",
  warn: "bg-surface-2 text-warn",
  selected: "bg-chip-selected text-on-chip-selected",
};

/**
 * YouTube Studio 風のフィルタチップ。角丸完全（rounded-full）・枠線なし。
 * @param tone 配色（既定 neutral）。"selected" は反転色（黒地白字/白地黒字）
 * @param children 表示内容
 * @param className 追加クラス
 */
export function Chip({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
