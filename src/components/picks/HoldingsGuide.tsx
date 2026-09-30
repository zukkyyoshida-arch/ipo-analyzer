import { DetailButton } from "@/components/analytics/DetailButton";

/**
 * ホームの「ピックアップ」→「大量保有」。この手法で何が分かるかの短い説明と、
 * 大量保有報告の新着が並ぶイベントカレンダー（/events）への導線。
 * @param recentCount 直近 recentDays 日に提出された大量保有報告書の数（recentLargeHoldingReports の件数）
 * @param recentDays 数える日数（イベントカレンダーの「新着」と同じ日数）
 */
export function HoldingsGuide({
  recentCount,
  recentDays,
}: {
  recentCount: number;
  recentDays: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">大量保有</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
        <p>
          上場企業の株を発行済みの5%を超えて持った投資家は、5営業日以内に大量保有報告書を出します。その後も持ち分が1%以上動くたびに変更報告書が出ます。
        </p>
        <p>
          上場から日の浅い銘柄なら、ファンドや事業会社が新しく株主に加わった・買い増した・持ち分を減らした、といった大口の動きがこの報告で分かります。
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted">
          直近{recentDays}日の提出
          <span className="ml-1.5 text-sm font-medium tabular-nums text-text">{recentCount}</span>
          <span className="ml-0.5">件</span>
        </span>
        <DetailButton href="/events" label="イベントカレンダー" />
      </div>
    </section>
  );
}
