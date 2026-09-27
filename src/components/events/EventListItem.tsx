import Link from "next/link";
import type { CalendarEvent, CalendarEventKind } from "@/lib/events";
import { CALENDAR_EVENT_LABELS } from "@/lib/events";
import { Chip, type ChipTone } from "@/components/ui/Chip";

// 種別ごとの Chip 配色。BB日程＝accent、上場後の注意系＝warn、参考情報＝neutral/up。
const KIND_TONE: Record<CalendarEventKind, ChipTone> = {
  bbStart: "accent",
  bbEnd: "accent",
  allotment: "accent",
  purchaseStart: "neutral",
  purchaseEnd: "neutral",
  listing: "up",
  lockupExpiry: "warn",
  priceReleaseWatch: "warn",
  firstEarnings: "neutral",
  largeHoldingReport: "up",
};

/**
 * イベント1件。種別Chip・銘柄名・1行detail を表示し、タップで詳細ページへ（44px以上）。
 */
export function EventListItem({ event }: { event: CalendarEvent }) {
  return (
    <Link
      href={`/ipo/${event.ipo.code}`}
      className="flex min-h-11 items-center gap-3 rounded-2xl border border-border bg-surface p-3 active:opacity-80"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={KIND_TONE[event.kind]}>
            {CALENDAR_EVENT_LABELS[event.kind]}
          </Chip>
          <span className="text-xs text-muted tabular-nums">
            {event.ipo.code}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-text">
          {event.ipo.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted tabular-nums">
          {event.detail}
        </p>
      </div>
      <span aria-hidden="true" className="shrink-0 text-muted">
        ›
      </span>
    </Link>
  );
}
