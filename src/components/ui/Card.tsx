import type { ReactNode } from "react";

/**
 * 基本のカード枠。角丸12px・1pxボーダー・影なし。
 * 内側余白は呼び出し側で指定する（既定 p-4 相当を各利用箇所が明示済み）。
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
    <div className={`rounded-xl border border-border bg-surface ${className}`}>
      {children}
    </div>
  );
}
