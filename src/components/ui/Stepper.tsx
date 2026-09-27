"use client";

/**
 * 数値の−/＋ステッパー。range inputと併用可能（rangeを別途表示する場合はこれを併置する）。
 * @param value 現在値
 * @param onChange 変更後の値を渡すコールバック
 * @param min 最小値（既定 0）
 * @param max 最大値（既定 100）
 * @param step 増減幅（既定 1）
 * @param label aria用ラベル
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  function clamp(v: number): number {
    return Math.max(min, Math.min(max, v));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={label ? `${label}を減らす` : "減らす"}
        onClick={() => onChange(clamp(value - step))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-lg font-medium text-text active:opacity-80"
      >
        −
      </button>
      <span className="min-w-8 text-center text-sm font-medium text-text">
        {value}
      </span>
      <button
        type="button"
        aria-label={label ? `${label}を増やす` : "増やす"}
        onClick={() => onChange(clamp(value + step))}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-lg font-medium text-text active:opacity-80"
      >
        ＋
      </button>
    </div>
  );
}
