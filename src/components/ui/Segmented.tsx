"use client";

/** Segmentedの選択肢1件。 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 横スクロール可能なセグメントコントロール（タブ的な単一選択UI）。
 * 選択肢が多い場合は折り返さず横スクロールする。
 * @param options 選択肢一覧
 * @param value 現在選択中の値
 * @param onChange 選択変更時のコールバック
 * @param className 追加クラス
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors active:opacity-80 ${
              active
                ? "border-accent bg-accent text-on-accent"
                : "border-border bg-surface text-muted"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
