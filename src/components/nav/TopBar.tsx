"use client";

import { useRouter, usePathname } from "next/navigation";

/**
 * 画面上部の固定バー。ルートでは「カブレーダー」タイトル、詳細ページ（/ipo/*）では戻るボタンを表示する。
 * sticky + backdrop-blur + safe-area対応。
 */
export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const isDetail = pathname?.startsWith("/ipo/") ?? false;

  return (
    <header className="sticky top-0 z-20 bg-bg pt-safe">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4 lg:max-w-5xl">
        {isDetail ? (
          <button
            type="button"
            onClick={() => {
              // 通知・ホーム画面の直リンクで開いた場合は戻る先が無いので一覧へ。
              const noHistory =
                window.history.length <= 1 ||
                (document.referrer !== "" &&
                  new URL(document.referrer).origin !== window.location.origin);
              if (noHistory) router.push("/ipos");
              else router.back();
            }}
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
        <span className="truncate text-[18px] font-medium text-text">
          カブレーダー
        </span>
      </div>
    </header>
  );
}
