"use client";

// ウォッチリストの星トグル。
export function WatchStar({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={active}
      aria-label={active ? "ウォッチリストから外す" : "ウォッチリストに追加"}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        active
          ? "text-amber-400 hover:bg-amber-50"
          : "text-slate-300 hover:bg-slate-100 hover:text-slate-400"
      }`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.72.99-5.8-4.2-4.1 5.8-.85L10 1.5z" />
      </svg>
    </button>
  );
}
