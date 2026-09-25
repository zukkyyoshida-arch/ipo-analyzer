import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-lg font-bold text-text">オフラインです</h1>
      <p className="text-sm text-muted">
        ネットワークに接続できませんでした。接続を確認してから再度お試しください。
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 items-center rounded-full border border-border bg-surface-2 px-4 text-sm font-semibold text-text active:opacity-80"
      >
        ホームに戻る
      </Link>
    </div>
  );
}
