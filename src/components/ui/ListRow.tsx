import type { ReactNode } from "react";

/**
 * key-value形式の縦積み行（基本情報一覧などで使用）。
 * @param label 左側のラベル
 * @param value 右側の値（文字列またはノード）
 * @param className 追加クラス
 */
export function ListRow({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 ${className}`}
    >
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-text">
        {value}
      </span>
    </div>
  );
}
