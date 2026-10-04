"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-medium">読み込めませんでした</h1>
      <p className="mt-2 text-sm text-muted">
        時間をおいて、もう一度お試しください。
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent"
        >
          再読み込み
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-sm"
        >
          ホームへ
        </Link>
      </div>
    </div>
  );
}
