import Link from "next/link";

/** カード右下の「詳細」ボタン（丸型）。 */
export function DetailButton({ href, label = "詳細" }: { href: string; label?: string }) {
  return (
    <div className="mt-3 flex justify-end">
      <Link
        href={href}
        className="inline-flex h-9 items-center rounded-full bg-surface-2 px-4 text-sm font-medium text-text active:opacity-80"
      >
        {label}
      </Link>
    </div>
  );
}
