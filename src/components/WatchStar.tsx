"use client";

/**
 * ウォッチリストの星トグル。タップ領域44px、Link内で使う想定のためstopPropagationする。
 * @param active ウォッチ中かどうか
 * @param onToggle トグル時のコールバック
 */
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
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors active:opacity-80 ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
        <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L10 14.9l-5.2 2.72.99-5.8-4.2-4.1 5.8-.85L10 1.5z" />
      </svg>
    </button>
  );
}
