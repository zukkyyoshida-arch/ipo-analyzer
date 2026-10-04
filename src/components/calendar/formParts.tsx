import type { ReactNode } from "react";

// 売買カレンダーの入力フォームで共通に使う見た目。

/** 入力欄（テキスト・数値・日付・選択）の共通クラス。 */
export const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none";

/** 主ボタン。 */
export const PRIMARY_BUTTON_CLASS =
  "min-h-11 flex-1 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent active:opacity-80 disabled:opacity-40";

/** 副ボタン。 */
export const SECONDARY_BUTTON_CLASS =
  "min-h-11 flex-1 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text active:opacity-80";

/** 削除ボタン。 */
export const DANGER_BUTTON_CLASS =
  "min-h-11 flex-1 rounded-xl border border-down/30 bg-down/15 px-4 text-sm font-medium text-down active:opacity-80";

/** ラベル付きの入力欄。 */
export function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-0.5">{children}</div>
      {note ? <span className="mt-0.5 block text-[11px] text-subtle">{note}</span> : null}
    </label>
  );
}
