"use client";

import { WatchStar } from "@/components/WatchStar";
import { openCollapsibleAnchor } from "@/components/ui/CollapsibleSection";

/**
 * 銘柄詳細の固定アクションバー（下タブ＝実測約69px の上）。★ウォッチ・BB記録（#bb）・メモ（#memo）。
 * 本文側は呼び出し側で下余白（pb-16 程度）を足して、最後のセクションが隠れないようにする。
 */
export function DetailActionBar({
  watched,
  onToggleWatch,
}: {
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const jump = (id: string) => () => {
    openCollapsibleAnchor(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  };
  const buttonClass =
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-text active:opacity-80";

  return (
    <div className="fixed inset-x-0 bottom-[calc(69px+env(safe-area-inset-bottom))] z-10 border-t border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-center gap-1 px-2 py-1 lg:max-w-5xl">
        {/* 星はボタン本体（WatchStar）。ラベル部分のタップでも切り替わるよう外側でも受ける。 */}
        <div className={`${buttonClass} cursor-pointer`} onClick={onToggleWatch}>
          <WatchStar active={watched} onToggle={onToggleWatch} />
          <span aria-hidden="true" className="-ml-2">
            {watched ? "ウォッチ中" : "ウォッチ"}
          </span>
        </div>
        <button type="button" className={buttonClass} onClick={jump("bb")}>
          BB記録
        </button>
        <button type="button" className={buttonClass} onClick={jump("memo")}>
          メモ
        </button>
      </div>
    </div>
  );
}
