import type { ReactNode } from "react";

/**
 * 該当データが無い場合の空表示。
 * @param title 見出し文言
 * @param description 補足文言（任意）
 * @param action ボタン等のアクション（任意）
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? (
        <p className="text-xs text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
