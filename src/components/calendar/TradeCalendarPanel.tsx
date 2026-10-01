"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { newId } from "@/hooks/usePortfolio";
import {
  CALENDAR_ITEM_LABELS,
  MANUAL_EVENT_KINDS,
  buildCalendarItems,
  groupByDate,
  monthGrid,
  relativeDayLabel,
  shiftMonth,
  soonItems,
  type CalendarItem,
  type CalendarItemKind,
  type ManualEvent,
  type ManualEventKind,
} from "@/lib/calendar/events";
import { hasHolidayTable, isBusinessDay, monthEndIso, monthStartIso, weekdayOf } from "@/lib/calendar/businessDays";
import { addDaysIso } from "@/lib/date";
import type { Holding } from "@/lib/portfolio/types";
import {
  DANGER_BUTTON_CLASS,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "./formParts";

/** 予定の種類ごとの色（点とラベル）。 */
const KIND_DOT: Record<CalendarItemKind, string> = {
  yutaiBuyStart: "bg-accent",
  yutaiLastCum: "bg-warn",
  yutaiEx: "bg-subtle",
  lastCum: "bg-warn",
  earnings: "bg-accent-2",
  buy: "bg-up",
  sell: "bg-down",
  other: "bg-muted",
};

const KIND_TEXT: Record<CalendarItemKind, string> = {
  yutaiBuyStart: "text-accent",
  yutaiLastCum: "text-warn",
  yutaiEx: "text-muted",
  lastCum: "text-warn",
  earnings: "text-accent-2",
  buy: "text-up",
  sell: "text-down",
  other: "text-muted",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 「10/5（月）」の表記。 */
function shortDay(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}（${WEEKDAYS[weekdayOf(iso)]}）`;
}

/**
 * ホームの「売買カレンダー」タブ。月送りのカレンダーと、その月の予定の一覧。
 * 優待の買い開始日・権利付最終日・権利落ち日（月ごと）、保有中の銘柄の権利付最終日・決算日、手動の予定を載せる。
 * 手動の予定は端末の localStorage に保存する（events・onSave・onRemove は HomeClient が持つ）。通知はしない。
 */
export function TradeCalendarPanel({
  todayIso,
  events,
  holdings,
  onSave,
  onRemove,
}: {
  todayIso: string;
  events: ManualEvent[];
  holdings: Holding[];
  onSave: (e: ManualEvent) => void;
  onRemove: (id: string) => void;
}) {
  const [ym, setYm] = useState(() => ({ year: Number(todayIso.slice(0, 4)), month: Number(todayIso.slice(5, 7)) }));
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManualEvent | null>(null);

  const monthFrom = monthStartIso(ym.year, ym.month);
  const monthTo = monthEndIso(ym.year, ym.month);
  const monthItems = useMemo(
    () => buildCalendarItems({ manual: events, holdings, fromIso: monthFrom, toIso: monthTo, todayIso }),
    [events, holdings, monthFrom, monthTo, todayIso],
  );
  const soon = useMemo(
    () =>
      soonItems(
        buildCalendarItems({ manual: events, holdings, fromIso: todayIso, toIso: addDaysIso(todayIso, 3), todayIso }),
        todayIso,
      ),
    [events, holdings, todayIso],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of monthItems) map.set(it.date, [...(map.get(it.date) ?? []), it]);
    return map;
  }, [monthItems]);
  const weeks = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const listed = selected ? monthItems.filter((i) => i.date === selected) : monthItems;

  const move = (n: number) => {
    setYm((cur) => shiftMonth(cur.year, cur.month, n));
    setSelected(null);
  };

  const openNew = () =>
    setEditing({ id: newId(), code: "", name: "", date: selected ?? todayIso, kind: "buy", memo: "" });

  const openEdit = (item: CalendarItem) => {
    const e = events.find((x) => x.id === item.manualId);
    if (e) setEditing(e);
  };

  return (
    <div>
      <Section title="今週の予定" note="今日から 3 日以内（通知はしません）">
        {soon.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-xs text-muted">
            3 日以内の予定はありません
          </p>
        ) : (
          <Card className="p-3">
            <ul className="space-y-2">
              {soon.map((it) => (
                <li key={it.key} className="flex items-baseline gap-2 text-sm">
                  <span className="w-11 shrink-0 text-xs font-medium text-text">{relativeDayLabel(it.date, todayIso)}</span>
                  <span className={`shrink-0 text-xs ${KIND_TEXT[it.kind]}`}>●</span>
                  <span className="min-w-0 flex-1 text-text">{it.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{shortDay(it.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="前の月"
          className="flex min-h-11 min-w-11 items-center justify-center text-lg text-muted"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium tabular-nums text-text">
            {ym.year}年{ym.month}月
          </h2>
          {monthFrom > todayIso || monthTo < todayIso ? (
            <button
              type="button"
              onClick={() => {
                setYm({ year: Number(todayIso.slice(0, 4)), month: Number(todayIso.slice(5, 7)) });
                setSelected(null);
              }}
              className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted"
            >
              今月
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label="次の月"
          className="flex min-h-11 min-w-11 items-center justify-center text-lg text-muted"
        >
          ›
        </button>
      </div>

      <Card className="p-2">
        <div className="grid grid-cols-7 text-center text-[11px] text-muted">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`py-1 ${i === 0 ? "text-down" : i === 6 ? "text-accent" : ""}`}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {weeks.flat().map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const items = byDate.get(d) ?? [];
            const closed = !isBusinessDay(d);
            const isToday = d === todayIso;
            const isSel = d === selected;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelected(isSel ? null : d)}
                aria-pressed={isSel}
                aria-label={`${shortDay(d)}${closed ? " 休場" : ""} 予定${items.length}件`}
                className={`flex min-h-12 flex-col items-center rounded-lg pt-1 ${
                  isSel ? "bg-chip-selected text-on-chip-selected" : isToday ? "bg-surface-2" : ""
                }`}
              >
                <span
                  className={`text-xs tabular-nums ${
                    isSel ? "" : closed ? "text-down/80" : "text-text"
                  } ${isToday ? "font-bold" : ""}`}
                >
                  {Number(d.slice(8, 10))}
                </span>
                <span className="mt-1 flex flex-wrap justify-center gap-0.5 px-0.5">
                  {items.slice(0, 4).map((it) => (
                    <span key={it.key} className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[it.kind]}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <p className="mt-1.5 text-[11px] text-subtle">
        赤い日付は休場（土日・祝日・12/31〜1/3）
        {hasHolidayTable(ym.year) ? "" : `。${ym.year}年の祝日は未登録のため土日と年末年始だけで判定しています`}
      </p>

      <div className="mt-4 mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text">
          {selected ? `${shortDay(selected)}の予定` : `${ym.month}月の予定`}
        </h3>
        <button
          type="button"
          onClick={openNew}
          className="min-h-9 rounded-full bg-chip-selected px-3 text-xs font-medium text-on-chip-selected active:opacity-80"
        >
          ＋ 予定を追加
        </button>
      </div>

      {listed.length === 0 ? (
        <EmptyState title="予定はありません" description="「予定を追加」で買い・売り・決算などを入れられます" />
      ) : (
        <div className="space-y-3">
          {groupByDate(listed).map((g) => (
            <div key={g.date}>
              <p className="mb-1 text-xs font-medium tabular-nums text-muted">
                <time dateTime={g.date}>{shortDay(g.date)}</time>
                {g.date >= todayIso ? <span className="ml-1.5 text-subtle">{relativeDayLabel(g.date, todayIso)}</span> : null}
              </p>
              <ul className="space-y-1.5">
                {g.items.map((it) => (
                  <li key={it.key}>
                    <ItemRow item={it} onEdit={it.source === "manual" ? () => openEdit(it) : undefined} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-subtle">
        優待の日付は、買い開始＝権利確定月の前月の最初の営業日、権利付最終日＝権利確定月の最終営業日の 2 営業日前（受渡し T+2）、
        権利落ち日＝その翌営業日で機械的に出しています。権利確定日が月末でない銘柄（20 日締めなど）は手動の予定で入れてください。
        予定はこの端末だけに保存されます。
      </p>

      <ManualEventSheet
        key={editing?.id ?? "none"}
        event={editing}
        isNew={editing !== null && !events.some((e) => e.id === editing.id)}
        onClose={() => setEditing(null)}
        onSave={(e) => {
          onSave(e);
          setEditing(null);
        }}
        onRemove={(id) => {
          onRemove(id);
          setEditing(null);
        }}
      />
    </div>
  );
}

function ItemRow({ item, onEdit }: { item: CalendarItem; onEdit?: () => void }) {
  const body = (
    <>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[item.kind]}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text">{item.title}</span>
        <span className="block text-[11px] text-muted">
          <span className={KIND_TEXT[item.kind]}>{CALENDAR_ITEM_LABELS[item.kind]}</span>
          {item.source === "yutai" ? " · 自動" : item.source === "holding" ? " · 保有中" : ""}
          {item.memo && item.source === "manual" ? ` · ${item.memo}` : ""}
        </span>
      </span>
      {onEdit ? <span className="shrink-0 self-center text-xs text-accent">編集</span> : null}
    </>
  );
  const cls = "flex w-full items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left";
  return onEdit ? (
    <button type="button" onClick={onEdit} className={`${cls} active:opacity-80`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 手動の予定の追加・編集シート。 */
function ManualEventSheet({
  event,
  isNew,
  onClose,
  onSave,
  onRemove,
}: {
  event: ManualEvent | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (e: ManualEvent) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ManualEvent | null>(event);
  if (!event || !draft) return null;
  const set = <K extends keyof ManualEvent>(k: K, v: ManualEvent[K]) => setDraft({ ...draft, [k]: v });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(draft.date);

  return (
    <BottomSheet open onClose={onClose} title={isNew ? "予定を追加" : "予定を編集"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim(), memo: draft.memo.trim() });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="銘柄コード">
            <input
              value={draft.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="例 7203"
              inputMode="text"
              autoCapitalize="characters"
              maxLength={4}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="名称（任意）">
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="日付">
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="種類">
            <select
              value={draft.kind}
              onChange={(e) => set("kind", e.target.value as ManualEventKind)}
              className={INPUT_CLASS}
            >
              {MANUAL_EVENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="メモ">
          <input value={draft.memo} onChange={(e) => set("memo", e.target.value)} className={INPUT_CLASS} />
        </Field>
        <div className="flex gap-2 pt-1">
          {isNew ? (
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
              やめる
            </button>
          ) : (
            <button type="button" onClick={() => onRemove(draft.id)} className={DANGER_BUTTON_CLASS}>
              削除
            </button>
          )}
          <button type="submit" disabled={!valid} className={PRIMARY_BUTTON_CLASS}>
            保存
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
