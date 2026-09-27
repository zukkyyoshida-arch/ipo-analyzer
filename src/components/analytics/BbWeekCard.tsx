import { DetailButton } from "./DetailButton";

/** 「今週の BB」（リアルタイム風）。受付中の社数と今後 14 日の日別イベント数。 */
export function BbWeekCard({
  openCount,
  daily,
}: {
  openCount: number;
  daily: { date: string; count: number }[];
}) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const total = daily.reduce((s, d) => s + d.count, 0);
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">今週の BB</h2>
      <p className="mt-1 flex items-center gap-2 text-xs text-muted">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60 [animation-duration:2s]" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
        </span>
        受付中
      </p>
      <p className="mt-3 text-[28px] leading-none tabular-nums text-text">
        {openCount}
        <span className="ml-1 text-sm text-muted">社</span>
      </p>
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted">今後 14 日の予定</span>
          <span className="text-xs tabular-nums text-muted">{total} 件</span>
        </div>
        <div className="mt-2 flex h-12 items-end gap-1" aria-hidden>
          {daily.map((d) => (
            <span
              key={d.date}
              title={`${d.date} ${d.count} 件`}
              className={`flex-1 rounded-sm ${d.count > 0 ? "bg-chart-line" : "bg-surface-2"}`}
              style={{ height: `${d.count > 0 ? Math.max(12, (d.count / max) * 100) : 6}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-subtle">
          <span>今日</span>
          <span>14 日後</span>
        </div>
      </div>
      <DetailButton href="/events" label="予定を見る" />
    </section>
  );
}
