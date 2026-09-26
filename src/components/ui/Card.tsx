import type { ReactNode } from "react";

/**
 * 基本のカード枠。角丸16px・1pxボーダー・影なし。
 * @param children カード内コンテンツ
 * @param className 追加クラス（padding調整等）
 * @param as "div"（既定）以外の要素で描画したい場合に使う想定は無いため常にdiv
 */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface ${className}`}
    >
      {children}
    </div>
  );
}
