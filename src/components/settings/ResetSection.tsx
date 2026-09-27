"use client";

import { useState } from "react";
import { Section } from "@/components/ui/Section";

/**
 * 設定をリセットするボタン。誤タップ防止のため一度目のタップで確認表示に切り替える。
 * @param onReset リセット実行時のコールバック
 */
export function ResetSection({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Section title="リセット">
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onReset();
              setConfirming(false);
            }}
            className="min-h-11 flex-1 rounded-xl border border-down/30 bg-down/15 px-4 text-sm font-medium text-down active:opacity-80"
          >
            本当にリセットする
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-11 flex-1 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text active:opacity-80"
          >
            キャンセル
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 w-full rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text active:opacity-80"
        >
          設定をリセット
        </button>
      )}
    </Section>
  );
}
