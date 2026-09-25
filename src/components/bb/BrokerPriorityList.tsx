import type { ReactNode } from "react";
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
 */
export function BrokerPriorityList({
  priorities,
  includeBrokers,
  renderAction,
  syndicateKnown = true,
}: {
  priorities: BrokerPriorityEntry[];
  includeBrokers?: Broker[];
  renderAction?: (broker: Broker) => ReactNode;
  syndicateKnown?: boolean;
}) {
  const rankedIds = new Set(priorities.map((p) => p.broker.id));
  const others = (includeBrokers ?? []).filter((b) => !rankedIds.has(b.id));
  // 配分表と照合できなかった証券会社（末尾・優先度算出対象外）には「優先」を付けない。
  const topId = priorities.find((p) => !p.allocationMissing)?.broker.id;

  return (
    <ul className="space-y-2.5">
      {priorities.map((entry) => (
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
            <span className="ml-1.5 tabular-nums">
              {entry.allocationMissing ? "（優先度 算出対象外）" : `（優先度 ${entry.priorityScore}）`}
            </span>
          </p>
        </BrokerRow>
      ))}
      {others.map((broker) => (
        <BrokerRow key={broker.id} broker={broker} action={renderAction?.(broker)}>
          <span className="text-sm text-text">{broker.name}</span>
          <p className="mt-0.5 text-[11px] text-muted">
            {syndicateKnown ? "幹事団外" : "幹事団 未取得"}・
            {LOTTERY_TYPE_LABELS[broker.lotteryType]}
          </p>
        </BrokerRow>
      ))}
    </ul>
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
