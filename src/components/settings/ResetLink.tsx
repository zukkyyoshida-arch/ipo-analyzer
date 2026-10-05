"use client";

/**
 * セクション見出し右の「既定に戻す」小リンク。そのセクションだけを既定に戻す。
 * @param label 対象の名前（読み上げ用）
 * @param onReset 実行時のコールバック
 */
export function ResetLink({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      aria-label={`${label}を既定に戻す`}
      className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-2 active:opacity-80"
    >
      既定に戻す
    </button>
  );
}
