"use client";

/** タブ 1 つ。count は名前の横の件数、dot は右上の赤い点（知らせたいことがあるとき）。 */
export interface TopTabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  dot?: boolean;
}

/** YouTube Studio 風のテキストタブ（選択中は下に 3px の線）。 */
export function TopTabs<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: TopTabOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative flex h-12 shrink-0 items-center text-[15px] font-medium ${
              active ? "text-text" : "text-muted"
            }`}
          >
            {o.label}
            {o.count ? <span className="ml-1 text-xs tabular-nums text-muted">{o.count}</span> : null}
            {o.dot ? (
              <span aria-label="お知らせあり" className="absolute right-[-8px] top-2.5 h-2 w-2 rounded-full bg-down" />
            ) : null}
            {active ? (
              <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-tab-indicator" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
