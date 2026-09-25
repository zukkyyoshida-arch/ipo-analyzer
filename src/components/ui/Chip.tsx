import type { ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "up" | "down" | "warn";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent/15 text-accent border-accent/30",
  up: "bg-up/15 text-up border-up/30",
  down: "bg-down/15 text-down border-down/30",
  warn: "bg-warn/15 text-warn border-warn/30",
};

/**
 * 小さな色分けタグ。ステータス・テーマタグ・警告表示などに使う。
 * @param tone 配色（既定 neutral）
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
