"use client";

/**
 * 銘柄名・コードの部分一致検索欄。IME入力もそのままonChangeで即時反映する。
 * @param value 現在の検索文字列
 * @param onChange 変更時のコールバック
 */
export function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      >
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M17 17l-4-4" />
      </svg>
      <input
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="銘柄名・コードで検索"
        aria-label="銘柄名・コードで検索"
        className="min-h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
      />
    </div>
  );
}
