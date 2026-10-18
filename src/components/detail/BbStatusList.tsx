"use client";

import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { UnderwriterAllocation } from "@/types/enriched";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { BbStatusSelect } from "@/components/BbStatusSelect";
import { useBbState } from "@/hooks/useUserData";
import { SBI_BROKER_ID } from "@/data/brokers";
import { rankBrokersForIpo } from "@/lib/bb/priority";

interface Row {
  broker: Broker;
  isLead: boolean;
  inSyndicate: boolean;
}

/**
 * BB申込状況（証券会社ごと）。1行＝証券名＋BbStatusSelect（1タップで状態を切替）。
 * - myBrokers（設定の「使っている証券」）があればその証券だけを並べる。記録済みの証券は設定外でも残す。
 * - 並びは「幹事団と申込優先順位」の順。引受に入っていない証券は「引受外」として畳む。
 * - 幹事団が未取得（主幹事・引受とも空）の銘柄は畳まずに全部並べる。
 * SBI証券のみチャレンジポイント投入数メモ欄を出す。
 */
export function BbStatusList({
  ipo,
  brokers,
  allocations,
  myBrokers = [],
}: {
  ipo: Ipo;
  brokers: Broker[];
  allocations?: UnderwriterAllocation[];
  myBrokers?: string[];
}) {
  const { getEntry, setStatus, setMemo } = useBbState();

  const hasRecord = (brokerId: string) => {
    const entry = getEntry(ipo.code, brokerId);
    return entry.status !== "none" || !!entry.memo?.trim();
  };
  const usesFilter = myBrokers.length > 0;
  const targets = usesFilter
    ? brokers.filter((b) => myBrokers.includes(b.id) || hasRecord(b.id))
    : brokers;
  const targetIds = new Set(targets.map((b) => b.id));

  const ranked = rankBrokersForIpo(ipo, brokers, allocations);
  const syndicateRows: Row[] = ranked
    .filter((e) => targetIds.has(e.broker.id))
    .map((e) => ({ broker: e.broker, isLead: e.isLead, inSyndicate: true }));
  const rankedIds = new Set(ranked.map((e) => e.broker.id));
  const outsideRows: Row[] = targets
    .filter((b) => !rankedIds.has(b.id))
    .map((b) => ({ broker: b, isLead: false, inSyndicate: false }));
  // 幹事団が未取得なら、引受外として畳むと全部隠れてしまうので畳まない。
  const syndicateUnknown = ranked.length === 0;
  const mainRows = syndicateUnknown ? outsideRows : syndicateRows;
  const foldedRows = syndicateUnknown ? [] : outsideRows;

  const renderRow = ({ broker, isLead, inSyndicate }: Row) => {
    const entry = getEntry(ipo.code, broker.id);
    const isSbi = broker.id === SBI_BROKER_ID;
    return (
      <div key={broker.id} className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text">{broker.name}</span>
            {isLead ? <Chip tone="accent">主幹事</Chip> : null}
            {!isLead && inSyndicate ? <Chip tone="neutral">引受</Chip> : null}
          </div>
          <BbStatusSelect
            value={entry.status}
            onChange={(status) => setStatus(ipo.code, broker.id, status)}
          />
        </div>
        {isSbi ? (
          <div className="mt-2">
            <label className="text-[11px] text-muted" htmlFor={`bb-memo-${ipo.code}`}>
              チャレンジポイント投入数メモ
            </label>
            <input
              id={`bb-memo-${ipo.code}`}
              type="text"
              value={entry.memo ?? ""}
              onChange={(e) => setMemo(ipo.code, broker.id, e.target.value)}
              placeholder="例: 300pt 投入"
              className="mt-0.5 min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none"
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="p-4">
      {mainRows.length > 0 ? (
        <div>{mainRows.map(renderRow)}</div>
      ) : (
        <p className="text-sm text-muted">
          {usesFilter ? "使っている証券は、この銘柄の幹事団に入っていません。" : "この銘柄の幹事団に入っている証券はありません。"}
        </p>
      )}
      {foldedRows.length > 0 ? (
        <Disclosure muted className="mt-2 border-t border-border pt-1" summary={`引受外（${foldedRows.length}社）`}>
          <div className="mt-1">{foldedRows.map(renderRow)}</div>
        </Disclosure>
      ) : null}
      {!usesFilter ? (
        <Link
          href="/settings#brokers"
          className="mt-2 flex min-h-11 items-center border-t border-border pt-2 text-xs text-accent active:opacity-80"
        >
          設定で自分の証券を選ぶと短くなります →
        </Link>
      ) : null}
    </Card>
  );
}
