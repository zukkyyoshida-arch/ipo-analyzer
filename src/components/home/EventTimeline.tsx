import Link from "next/link";
import type { HomeEvent } from "@/lib/home";
import { homeEventLabel } from "@/lib/home";
import { DetailButton } from "@/components/analytics/DetailButton";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dayParts(iso: string): { md: string; wd: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    md: `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`,
    wd: Number.isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()],
  };
}

/** 今後 14 日の予定（BB 開始・抽選・購入期間開始・上場）を日付順のリストで表示する。 */
export function EventTimeline({ events }: { events: HomeEvent[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text">今後 14 日の予定</h2>
        <span className="text-xs tabular-nums text-muted">{events.length} 件</span>
      </div>
      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">今後 14 日の予定はありません</p>
      ) : (
        <ol className="mt-2">
          {events.map((event, i) => {
            const { md, wd } = dayParts(event.date);
            return (
              <li
                key={`${event.ipo.code}-${event.kind}-${i}`}
                className="border-b border-border last:border-b-0"
              >
                <Link
                  href={`/ipo/${event.ipo.code}`}
                  // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
                  prefetch={false}
                  className="flex min-h-16 items-center gap-3 py-2 active:opacity-80"
                >
                  <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 leading-tight">
                    <span className="text-xs font-medium tabular-nums text-text">{md}</span>
                    <span className="text-[11px] text-muted">{wd}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{event.ipo.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {event.ipo.code} · {event.ipo.market}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text">
                    {homeEventLabel(event.kind)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <DetailButton href="/events" label="カレンダー" />
    </section>
  );
}
