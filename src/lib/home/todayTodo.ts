import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import { addDaysIso } from "@/lib/date";
import { ipoScheduleEventsInRange, type CalendarEventKind } from "@/lib/events";
import { isLeadBroker, matchBrokerName } from "@/lib/bb/priority";

// ホーム最上部「今日のやること」の組み立て。純関数。
// 日程の取り出しはイベントカレンダー（lib/events）の ipoScheduleEventsInRange を使い、二重に実装しない。
// 「今日」は呼び出し側が todayIso として渡す（Date.now は呼ばない）。

/** 今日のやること・売買カレンダーに出す IPO の自動イベントの種別。 */
export const TODO_EVENT_KINDS = [
  "bbEnd",
  "allotment",
  "purchaseEnd",
  "listing",
  "lockupExpiry",
] as const satisfies readonly CalendarEventKind[];

export type TodoEventKind = (typeof TODO_EVENT_KINDS)[number];

export const TODO_EVENT_LABELS: Record<TodoEventKind, string> = {
  bbEnd: "BB締切",
  allotment: "抽選発表",
  purchaseEnd: "購入期限",
  listing: "上場",
  lockupExpiry: "ロック解除",
};

/** その場で申込状況を記録できる行（BB 締切・抽選）。 */
const RECORDABLE: ReadonlySet<TodoEventKind> = new Set<TodoEventKind>(["bbEnd", "allotment"]);

export interface TodoItem {
  key: string;
  ipo: Ipo;
  kind: TodoEventKind;
  date: string;
  /** 今日 / 明日 */
  when: "today" | "tomorrow";
  /** 「BB締切」などの見出し */
  label: string;
  /** その場で申込状況（申込済・当選など）を記録できるか */
  recordable: boolean;
}

/**
 * 今日・明日の IPO の自動イベント（BB 締切・抽選・購入期限・上場・ロック解除）。
 * 並びは今日 → 明日、同じ日は種別順（BB 締切が先）→ コード順。
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function todayTodoItems(ipos: Ipo[], todayIso: string): TodoItem[] {
  const tomorrow = addDaysIso(todayIso, 1);
  return ipoScheduleEventsInRange(ipos, todayIso, tomorrow, TODO_EVENT_KINDS).map((e) => {
    const kind = e.kind as TodoEventKind;
    return {
      key: `${e.ipo.code}:${kind}:${e.date}`,
      ipo: e.ipo,
      kind,
      date: e.date,
      when: e.date === todayIso ? "today" : "tomorrow",
      label: TODO_EVENT_LABELS[kind],
      recordable: RECORDABLE.has(kind),
    };
  });
}

/**
 * ワンタップ記録の既定の証券会社。主幹事（共同主幹事ならマスタ順で先に当たる社）→ 幹事団の先頭の順に、
 * 証券会社マスタにある社を探す。見つからなければ null（記録ボタンを出さない）。
 */
export function defaultRecordBroker(ipo: Ipo, brokers: readonly Broker[]): Broker | null {
  const lead = brokers.find((b) => isLeadBroker(b, ipo.leadUnderwriter));
  if (lead) return lead;
  for (const name of ipo.underwriters) {
    const hit = matchBrokerName(name, [...brokers]);
    if (hit) return hit;
  }
  return null;
}
