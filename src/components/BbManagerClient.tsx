"use client";

import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import { useBbState } from "@/hooks/useUserData";
import { estimatedLockAmount } from "@/lib/format";
import { BbSummary } from "@/components/bb/BbSummary";
import { BbIpoCard } from "@/components/bb/BbIpoCard";
import { EmptyState } from "@/components/ui/EmptyState";

// 資金拘束の対象とするステータス（申込済・当選）。
const LOCK_STATUSES: BbStatus[] = ["applied", "won"];

// BB画面の対象銘柄ステータス（上場前・受付中・公開価格決定済）。
const TARGET_STATUSES: Ipo["status"][] = ["upcoming", "bb_open", "priced"];

/**
 * BB（ブックビルディング）管理画面のクライアント本体。
 * ステータス別集計・資金拘束目安の表示と、対象銘柄ごとの証券会社別申込ステータス管理を行う。
 * @param ipos 全銘柄
 * @param brokers 証券会社一覧
 */
export function BbManagerClient({
  ipos,
  brokers,
}: {
  ipos: Ipo[];
  brokers: Broker[];
}) {
  const { bbState, getEntry, setStatus } = useBbState();

  // 対象銘柄: status が upcoming/bb_open/priced のもの、または
  // 既にいずれかの証券会社で申込記録（statusがnone以外）がある銘柄。
  const targetIpos = useMemo(() => {
    return ipos.filter((ipo) => {
      if (TARGET_STATUSES.includes(ipo.status)) return true;
      const records = bbState[ipo.code];
      if (!records) return false;
      return Object.values(records).some((entry) => entry.status !== "none");
    });
  }, [ipos, bbState]);

  // ステータス別集計と資金拘束目安合計を算出（対象銘柄×証券会社の全組み合わせ）。
  const summary = useMemo(() => {
    const counts: Record<BbStatus, number> = {
      none: 0,
      planned: 0,
      applied: 0,
      won: 0,
      waitlist: 0,
      lost: 0,
      declined: 0,
      purchased: 0,
    };
    let lockAmount = 0;
    for (const ipo of targetIpos) {
      for (const broker of brokers) {
        const entry = bbState[ipo.code]?.[broker.id];
        const status = entry?.status ?? "none";
        counts[status] += 1;
        if (LOCK_STATUSES.includes(status)) {
          lockAmount += estimatedLockAmount(ipo);
        }
      }
    }
    return { counts, lockAmount };
  }, [bbState, targetIpos, brokers]);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-text">BB管理</h1>

      <BbSummary counts={summary.counts} lockAmount={summary.lockAmount} />

      {targetIpos.length === 0 ? (
        <EmptyState title="BB期間中・上場予定の銘柄がありません" />
      ) : (
        <div className="space-y-3">
          {targetIpos.map((ipo) => (
            <BbIpoCard
              key={ipo.code}
              ipo={ipo}
              brokers={brokers}
              getEntry={getEntry}
              setStatus={setStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}
