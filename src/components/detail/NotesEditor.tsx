"use client";

import { useNotes } from "@/hooks/useUserData";

/**
 * 銘柄メモ欄。textarea の内容を useNotes 経由で自動保存する。
 */
export function NotesEditor({ code }: { code: string }) {
  const { getNote, setNote } = useNotes();

  return (
    <div>
      <textarea
        value={getNote(code)}
        onChange={(e) => setNote(code, e.target.value)}
        placeholder="この銘柄についてのメモ（自動保存）"
        rows={4}
        className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm text-text focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-muted">入力内容は自動保存されます。</p>
    </div>
  );
}
