import Link from "next/link";
import type { HomeEvent } from "@/lib/home";
import { homeEventLabel } from "@/lib/home";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";
import { formatDate } from "@/lib/format";

/**
 * 今後14日のイベントタイムライン。BB開始・抽選・購入期間開始・上場を日付順に表示する。
 * データが無い場合は「上場予定」のみのメッセージを出す。
 */
export function EventTimeline({ events }: { events: HomeEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="今後14日以内の予定はありません"
        description="上場予定の銘柄が増えると、BB開始・抽選・購入期間・上場のタイミングをここに表示します。"
      />
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((event, i) => (
        <li key={`${event.ipo.code}-${event.kind}-${i}`}>
          <Link
            href={`/ipo/${event.ipo.code}`}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 active:opacity-80"
          >
            <div className="flex min-w-14 flex-col items-center text-center">
              <span className="text-xs font-bold text-text">
                {formatDate(event.date)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Chip tone="accent">{homeEventLabel(event.kind)}</Chip>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-text">
                {event.ipo.name}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
