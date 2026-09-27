"use client";

/** YouTube Studio 風のテキストタブ（選択中は下に 3px の線）。 */
export function TopTabs<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string }[];
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
            {active ? (
              <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-tab-indicator" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
