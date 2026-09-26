"use client";

import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { BbStatusSelect } from "@/components/BbStatusSelect";
import { useBbState } from "@/hooks/useUserData";
import { SBI_BROKER_ID } from "@/data/brokers";

/**
 * BB申込状況（証券会社ごと）。ListRow風の1行＋BbStatusSelect。SBI証券のみ
 * チャレンジポイント投入数メモ欄を表示する。
 */
export function BbStatusList({ ipo, brokers }: { ipo: Ipo; brokers: Broker[] }) {
  const { getEntry, setStatus, setMemo } = useBbState();

  return (
    <Card className="p-4">
      <div className="space-y-3">
        {brokers.map((broker) => {
          const entry = getEntry(ipo.code, broker.id);
          const isSbi = broker.id === SBI_BROKER_ID;
          const isLead = broker.name === ipo.leadUnderwriter;
          const inSyndicate = ipo.underwriters.includes(broker.name);

          return (
            <div
              key={broker.id}
              className="border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-text">
                    {broker.name}
                  </span>
                  {isLead ? <Chip tone="accent">主幹事</Chip> : null}
                  {!isLead && inSyndicate ? (
                    <Chip tone="neutral">引受</Chip>
                  ) : null}
                </div>
                <BbStatusSelect
                  value={entry.status}
                  onChange={(status) => setStatus(ipo.code, broker.id, status)}
                />
              </div>
              {isSbi ? (
                <div className="mt-2">
                  <label className="text-[11px] text-muted">
                    チャレンジポイント投入数メモ
                  </label>
                  <input
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
        })}
      </div>
    </Card>
  );
}
