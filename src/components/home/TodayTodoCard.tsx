"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import type { BbStatus } from "@/types/broker";
import { BB_STATUS_LABELS } from "@/types/broker";
import { DEFAULT_BROKERS } from "@/data/brokers";
import { useBbState } from "@/hooks/useUserData";
import { defaultRecordBroker, todayTodoItems, type TodoItem } from "@/lib/home/todayTodo";

/** ワンタップ記録のボタン（申込済・当選・補欠・落選）。 */
const QUICK_STATUSES: BbStatus[] = ["applied", "won", "waitlist", "lost"];

/** 選んでいるときの文字色（BbStatusSelect と同じ色分け）。 */
const STATUS_TEXT: Partial<Record<BbStatus, string>> = {
  applied: "text-accent",
  won: "text-ok",
  waitlist: "text-warn",
  lost: "text-ng",
};

const WHEN_LABEL = { today: "今日", tomorrow: "明日" } as const;

/**
 * ホーム「ピックアップ」最上部の「今日のやること」。今日・明日の BB 締切・抽選発表・購入期限・上場・ロック解除を行で出す。
 * BB 締切・抽選の行は、主幹事（マスタに無ければ幹事団の先頭）を既定の証券会社にして、その場で申込状況を記録できる
 * （BB 管理・銘柄詳細と同じ useBbState に保存。選んでいるボタンをもう一度押すと「未対応」に戻す）。
 * @param ipos 全銘柄
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function TodayTodoCard({ ipos, todayIso }: { ipos: Ipo[]; todayIso: string }) {
  const items = useMemo(() => todayTodoItems(ipos, todayIso), [ipos, todayIso]);
  const { getEntry, setStatus, hydrated } = useBbState();

  return (
    <section aria-label="今日のやること" className="rounded-2xl border border-border bg-surface px-4 py-3">
      <h2 className="text-sm font-medium text-text">今日のやること</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted">今日の予定はありません</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {items.map((item) => (
            <TodoRow
              key={item.key}
              item={item}
              hydrated={hydrated}
              getStatus={(brokerId) => getEntry(item.ipo.code, brokerId).status}
              onRecord={(brokerId, s) => setStatus(item.ipo.code, brokerId, s)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TodoRow({
  item,
  hydrated,
  getStatus,
  onRecord,
}: {
  item: TodoItem;
  /** false のあいだ（localStorage を読む前）は記録ボタンの選択状態を出さない */
  hydrated: boolean;
  getStatus: (brokerId: string) => BbStatus;
  onRecord: (brokerId: string, status: BbStatus) => void;
}) {
  const { ipo } = item;
  const broker = item.recordable ? defaultRecordBroker(ipo, DEFAULT_BROKERS) : null;
  const current: BbStatus = broker && hydrated ? getStatus(broker.id) : "none";

  return (
    <li className="py-2">
      <div className="flex min-w-0 items-baseline gap-2 text-sm">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            item.when === "today" ? "bg-chip-selected text-on-chip-selected" : "bg-surface-2 text-muted"
          }`}
        >
          {WHEN_LABEL[item.when]}
        </span>
        <span className="shrink-0 text-xs font-medium text-text">{item.label}</span>
        <Link
          href={`/ipo/${ipo.code}`}
          prefetch={false}
          className="min-w-0 flex-1 truncate text-text hover:underline active:opacity-80"
        >
          {ipo.name}
          <span className="ml-1 text-xs tabular-nums text-muted">（{ipo.code}）</span>
        </Link>
      </div>
      {broker ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] text-subtle">{broker.name}</span>
          {QUICK_STATUSES.map((s) => {
            const on = current === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                aria-label={`${ipo.name}を${broker.name}で${BB_STATUS_LABELS[s]}として記録`}
                onClick={() => onRecord(broker.id, on ? "none" : s)}
                className={`min-h-9 rounded-full px-3 text-xs font-medium active:opacity-80 ${
                  on ? "bg-chip-selected text-on-chip-selected" : `bg-surface-2 ${STATUS_TEXT[s] ?? "text-muted"}`
                }`}
              >
                {BB_STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
