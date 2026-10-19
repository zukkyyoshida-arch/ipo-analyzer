import type { ReactNode } from "react";

/**
 * 見出しごと畳める Section（<details>）。既定で閉じ、見出し行をタップで開く。
 * アンカー（#id）から飛んできたときは openCollapsibleAnchor(id) で開く。
 * @param id アンカー id（<section> に付く）
 * @param title 見出し文言
 * @param note 見出し下の補足（閉じているときも見える）
 * @param action 見出し右側の要素（任意）
 * @param defaultOpen 最初から開いておく
 */
export function CollapsibleSection({
  id,
  title,
  note,
  action,
  children,
  defaultOpen = false,
  className = "",
}: {
  id?: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <section id={id} className={`mb-6 scroll-mt-32 ${className}`}>
      <details data-anchor-open="" open={defaultOpen} className="group">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-2 marker:content-none group-open:mb-2 group-open:border-transparent group-open:bg-transparent group-open:px-0 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-base font-medium text-text">{title}</span>
            {note ? <span className="mt-0.5 block text-xs text-subtle">{note}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {action}
            <span aria-hidden="true" className="inline-block text-muted transition-transform group-open:rotate-90">
              ▶
            </span>
          </span>
        </summary>
        {children}
      </details>
    </section>
  );
}

/**
 * id の要素（またはその中）にある畳み Section を開く。開いたら true。
 * ジャンプ用のチップや固定アクションバーから、遷移・スクロールの直前に呼ぶ。
 */
export function openCollapsibleAnchor(id: string): boolean {
  if (typeof document === "undefined" || id === "") return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const details = el.matches("details[data-anchor-open]")
    ? el
    : el.querySelector("details[data-anchor-open]");
  if (details instanceof HTMLDetailsElement && !details.open) {
    details.open = true;
    return true;
  }
  return false;
}
