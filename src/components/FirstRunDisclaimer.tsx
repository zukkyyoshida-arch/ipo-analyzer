"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export const DISCLAIMER_ACCEPTED_KEY = "kabu-radar:disclaimer-accepted:v1";

/**
 * 初回起動時だけ免責をフルで出し、同意した日時（ISO）を localStorage に保存する。
 * 保存済みなら何も出さない。hydration 完了後にだけ判定するので SSR と不一致にならない。
 * 背景タップで閉じても同意は保存されず、次回また出る。
 */
export function FirstRunDisclaimer() {
  const [acceptedAt, setAcceptedAt, hydrated] = useLocalStorage<string>(DISCLAIMER_ACCEPTED_KEY, "");
  const hasAccepted = acceptedAt !== "";
  // 背景タップ・Escape で閉じた分はこのセッション中だけ隠す（保存はしない）。
  const [dismissed, setDismissed] = useState(false);

  const open = hydrated && !hasAccepted && !dismissed;

  return (
    <BottomSheet open={open} onClose={() => setDismissed(true)} title="ご利用にあたって">
      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p>
          本アプリは公開情報をユーザー設定ルールで機械的に整理する個人用ツールです。投資助言を目的とせず、特定銘柄の売買の可否を示すものではありません。投資判断はご自身の責任で行ってください。公開情報を機械的に取得したもので正確性・完全性を保証しません。
        </p>
        <p>通知やスコアは機械的な目安で、投資助言ではありません。</p>
      </div>
      <button
        type="button"
        onClick={() => setAcceptedAt(new Date().toISOString())}
        className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-4 text-sm font-medium text-on-accent"
      >
        同意して使いはじめる
      </button>
    </BottomSheet>
  );
}
