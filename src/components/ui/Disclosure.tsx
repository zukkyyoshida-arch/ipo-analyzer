import type { ReactNode } from "react";

/**
 * 折りたたみ（<details>）。開くと「▶」が 90 度回る。summary はタップ領域 44px 以上。
 * @param summary 見出し部分
 * @param children 展開時の本文
 * @param className <details> への追加クラス
 * @param muted summary を控えめな色にする
 */
export function Disclosure({
  summary,
  children,
  className = "",
  muted = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <details className={`group ${className}`}>
      <summary
        className={`flex min-h-11 cursor-pointer items-center text-sm marker:content-none ${
          muted ? "text-muted" : "font-medium text-text"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block text-muted transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          {summary}
        </span>
      </summary>
      {children}
    </details>
  );
}
