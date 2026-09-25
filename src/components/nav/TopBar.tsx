"use client";

import { useRouter, usePathname } from "next/navigation";

/**
 * 画面上部の固定バー。ルートでは「Apollo IPO」タイトル、詳細ページ（/ipo/*）では戻るボタンを表示する。
 * sticky + backdrop-blur + safe-area対応。
 */
export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const isDetail = pathname?.startsWith("/ipo/") ?? false;

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 pt-safe backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        {isDetail ? (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="戻る"
            className="flex min-h-11 min-w-11 items-center justify-center -ml-2 text-text active:opacity-80"
          >
            <svg
              viewBox="0 0 20 20"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.5 4.5L6 10l6.5 5.5" />
            </svg>
          </button>
        ) : null}
        <span className="truncate text-base font-bold text-text">
          Apollo IPO
        </span>
      </div>
    </header>
  );
}
