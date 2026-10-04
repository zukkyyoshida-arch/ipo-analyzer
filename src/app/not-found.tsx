import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-medium">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-muted">
        URL が違うか、銘柄コードが存在しません。
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <Link
          href="/ipos"
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent"
        >
          銘柄一覧へ
        </Link>
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
