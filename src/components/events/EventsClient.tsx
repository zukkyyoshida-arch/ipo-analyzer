import type { Ipo } from "@/types/ipo";
import type { CalendarEvent } from "@/lib/events";
import {
  groupEventsByDate,
  recentLargeHoldingReports,
  upcomingCalendarEvents,
} from "@/lib/events";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/Section";
import { EventListItem } from "./EventListItem";
import { EventStatsNote } from "./EventStatsNote";

const UPCOMING_DAYS = 90;
const RECENT_DAYS = 30;

/**
 * イベントカレンダー画面の本体。操作状態を持たないため "use client" は付けず、
 * page.tsx（Server Component）から渡された todayIso で集計する。
 */
export function EventsClient({
  ipos,
  todayIso,
}: {
  ipos: Ipo[];
  todayIso: string;
}) {
  const recent = recentLargeHoldingReports(ipos, todayIso, RECENT_DAYS);
  const upcoming = upcomingCalendarEvents(ipos, todayIso, UPCOMING_DAYS);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-text">イベントカレンダー</h1>
        <p className="mt-1 text-xs text-muted">
          BB日程・上場・ロックアップ解除・初決算などを公開情報から機械的に集計した参考情報です
        </p>
      </div>

      {recent.length > 0 ? (
        <Section
          title="新着"
          note={`直近${RECENT_DAYS}日以内に提出された大量保有報告書`}
        >
          <EventList events={recent} />
        </Section>
      ) : null}

      <Section
        title={`今後${UPCOMING_DAYS}日の予定`}
        note="日付の早い順。タップで銘柄詳細へ"
      >
        {upcoming.length === 0 ? (
          <EmptyState
            title={`今後${UPCOMING_DAYS}日以内の予定はありません`}
            description="日程データが取得できると、BB期間・上場・ロックアップ解除などをここに表示します。"
          />
        ) : (
          <EventList events={upcoming} />
        )}
      </Section>

      <Section title="イベント前後の実績" note="過去IPOの機械的集計（参考情報）">
        <EventStatsNote />
      </Section>
    </div>
  );
}

/** 日付ごとに小見出し（YYYY/MM/DD）を付けて並べる。 */
function EventList({ events }: { events: CalendarEvent[] }) {
  const groups = groupEventsByDate(events);
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.date}>
          <h3 className="mb-2 text-xs font-bold text-muted tabular-nums">
            <time dateTime={group.date}>{formatDate(group.date)}</time>
          </h3>
          <ol className="space-y-2">
            {group.events.map((event) => (
              <li key={`${event.ipo.code}-${event.kind}-${event.date}`}>
                <EventListItem event={event} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
