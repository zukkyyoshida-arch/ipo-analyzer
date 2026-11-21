"use client";

import { useState, type ReactNode } from "react";
import type { Broker } from "@/types/broker";
import type { BrokerPriorityEntry } from "@/lib/bb/priority";
import { LOTTERY_TYPE_LABELS } from "@/lib/bb/priority";
import { Chip } from "@/components/ui/Chip";

/**
 * 銘柄1件の証券会社優先順位リスト。優先順位順（rankBrokersForIpo の結果順）に並べ、
 * 先頭に「優先」チップを付ける。includeBrokers を渡すと幹事団外の証券会社も末尾に並べる
 * （BB管理でステータス変更を全社分残すため）。
 * @param priorities rankBrokersForIpo の結果（降順ソート済み）
 * @param includeBrokers 幹事団外も表示する場合の証券会社一覧（任意）
 * @param renderAction 行右側に置く要素（ステータス選択など。任意）
 * @param syndicateKnown 幹事団の情報が取れているか（false なら末尾の行を「幹事団 未取得」と表示）
 * @param keepVisible 渡すと行を畳む。「優先」・主幹事の社と keepVisible が true の社（申込状況を記録済みなど）だけを
 *   最初に出し、残りは「他N社を表示」ボタンで開く。全社が表示対象ならボタンは出さない
 */
export function BrokerPriorityList({
  priorities,
  includeBrokers,
  renderAction,
  syndicateKnown = true,
  keepVisible,
}: {
  priorities: BrokerPriorityEntry[];
  includeBrokers?: Broker[];
  renderAction?: (broker: Broker) => ReactNode;
  syndicateKnown?: boolean;
  keepVisible?: (broker: Broker) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rankedIds = new Set(priorities.map((p) => p.broker.id));
  const others = (includeBrokers ?? []).filter((b) => !rankedIds.has(b.id));
  // 配分表と照合できなかった証券会社（末尾・優先度算出対象外）には「優先」を付けない。
  const topId = priorities.find((p) => !p.allocationMissing)?.broker.id;

  // 畳むときに最初から出す社（優先・主幹事・keepVisible）。keepVisible 未指定なら畳まない。
  const shown = (broker: Broker, isLead: boolean): boolean =>
    !keepVisible || expanded || broker.id === topId || isLead || keepVisible(broker);
  const visiblePriorities = priorities.filter((entry) => shown(entry.broker, entry.isLead));
  const visibleOthers = others.filter((broker) => shown(broker, false));
  const total = priorities.length + others.length;
  const hiddenCount = total - visiblePriorities.length - visibleOthers.length;
  // 一度開いたら「閉じる」を出す（畳める社が1社も無いときはボタン自体を出さない）。
  const collapsibleCount = keepVisible
    ? priorities.filter((e) => !(e.broker.id === topId || e.isLead || keepVisible(e.broker))).length +
      others.filter((b) => !keepVisible(b)).length
    : 0;

  return (
    <>
      <ul className="space-y-2.5">
        {visiblePriorities.map((entry) => (
          <BrokerRow
            key={entry.broker.id}
            broker={entry.broker}
            action={renderAction?.(entry.broker)}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-text">{entry.broker.name}</span>
              {entry.broker.id === topId && <Chip tone="accent">優先</Chip>}
              {entry.isLead && <Chip tone="neutral">主幹事</Chip>}
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              {entry.reason}
              {typeof entry.lotteryUnits === "number" ? (
                <span className="tabular-nums">・抽選枠 {entry.lotteryUnits.toLocaleString()}枚</span>
              ) : null}
              <span className="ml-1.5 tabular-nums">
                {entry.allocationMissing ? "（優先度 算出対象外）" : `（優先度 ${entry.priorityScore}）`}
              </span>
            </p>
          </BrokerRow>
        ))}
        {visibleOthers.map((broker) => (
          <BrokerRow key={broker.id} broker={broker} action={renderAction?.(broker)}>
            <span className="text-sm text-text">{broker.name}</span>
            <p className="mt-0.5 text-[11px] text-muted">
              {syndicateKnown ? "幹事団外" : "幹事団 未取得"}・
              {LOTTERY_TYPE_LABELS[broker.lotteryType]}
            </p>
          </BrokerRow>
        ))}
      </ul>
      {collapsibleCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-border text-sm text-accent-2 active:opacity-80"
        >
          {expanded
            ? "閉じる"
            : hiddenCount === total
              ? `証券会社${total}社を表示`
              : `他${hiddenCount}社を表示`}
        </button>
      ) : null}
    </>
  );
}

function BrokerRow({
  broker,
  action,
  children,
}: {
  broker: Broker;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 first:border-t-0 first:pt-0"
      data-broker-id={broker.id}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="min-w-[7.5rem]">{action}</div> : null}
    </li>
  );
}
