import type { ReactNode } from "react";

/**
 * 画面内の見出しセクション。見出し＋補足＋任意のヘッダー右側要素＋本文。
 * @param title 見出し文言
 * @param note 見出し下の補足文言（任意）
 * @param action 見出し右側に置くアクション要素（任意。「すべて見る」等）
 * @param children 本文
 * @param className 追加クラス
 */
export function Section({
  title,
  note,
  action,
  children,
  className = "",
  id,
}: {
  id?: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mb-6 scroll-mt-32 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-text">{title}</h2>
          {note ? <p className="mt-0.5 text-xs text-subtle">{note}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
