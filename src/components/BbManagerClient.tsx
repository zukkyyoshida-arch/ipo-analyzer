"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Ipo, Sentiment } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import type { IpoEnriched } from "@/types/enriched";
import { useBbState } from "@/hooks/useUserData";
import { useSettings } from "@/hooks/useSettings";
import { estimatedLockAmount } from "@/lib/format";
import { assessCompleteness } from "@/lib/completeness";
import { buildBbContext, scoreBbParticipation } from "@/lib/scoring/bb";
import { underwriterBreakEvenStat } from "@/lib/stats";
import { rankBrokersForIpo } from "@/lib/bb/priority";
import { buildFundLockPeriods, groupOverlappingLocks } from "@/lib/bb/fundLock";
import { BbSummary } from "@/components/bb/BbSummary";
import { BbIpoCard } from "@/components/bb/BbIpoCard";
import { FundLockCalendar } from "@/components/bb/FundLockCalendar";
import { MyRecords } from "@/components/bb/MyRecords";
import { EmptyState } from "@/components/ui/EmptyState";

// 資金拘束の対象とするステータス（申込済・当選）。
const LOCK_STATUSES: BbStatus[] = ["applied", "won"];

// BB画面の対象銘柄ステータス（上場前・受付中・公開価格決定済）。
const TARGET_STATUSES: Ipo["status"][] = ["upcoming", "bb_open", "priced"];

/**
 * BB（ブックビルディング）管理画面のクライアント本体。
 * ステータス別集計・資金拘束目安・資金拘束の重なりの表示と、対象銘柄ごとの
 * 証券会社別申込ステータス管理（申込先の参考順・BB参加スコア付き）を行う。
 * @param ipos 全銘柄（主幹事実績の集計母数にも使う）
 * @param brokers 証券会社一覧
 * @param enriched 96ut 由来の補完レイヤーのうち幹事配分（未指定なら配分未取得扱い）
 * @param autoSentiment 地合いの自動判定値（BB参加スコアの地合い項目に使う。未指定なら中立）
 */
export function BbManagerClient({
  ipos,
  brokers,
  enriched = [],
  autoSentiment,
}: {
  ipos: Ipo[];
  brokers: Broker[];
  enriched?: Pick<IpoEnriched, "code" | "underwriterAllocations">[];
  autoSentiment?: Sentiment;
}) {
  const { bbState, getEntry, setStatus } = useBbState();
  const { settings } = useSettings(autoSentiment);

  // 日本時間の今日（YYYY-MM-DD）。SSR とハイドレーションの不一致を避けるためマウント後に決める
  // （それまでは undefined＝終了済みの拘束期間も除外しない従来どおりの表示）。
  const [todayIso, setTodayIso] = useState<string | undefined>(undefined);
  useEffect(() => {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayIso(jst.toISOString().slice(0, 10));
  }, []);

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

  // 銘柄ごとの申込先の参考順（幹事配分×抽選方式）。
  const prioritiesByCode = useMemo(() => {
    const allocationsByCode = new Map(
      enriched.map((e) => [e.code, e.underwriterAllocations]),
    );
    return new Map(
      targetIpos.map((ipo) => [
        ipo.code,
        rankBrokersForIpo(ipo, brokers, allocationsByCode.get(ipo.code)),
      ]),
    );
  }, [targetIpos, brokers, enriched]);

  // BB参加スコア。データ不足（insufficient）の銘柄は null（バッジ非表示）。
  const bbScoreByCode = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const ipo of targetIpos) {
      if (assessCompleteness(ipo).level === "insufficient") {
        map.set(ipo.code, null);
        continue;
      }
      const stat = underwriterBreakEvenStat(ipos, ipo.leadUnderwriter);
      map.set(
        ipo.code,
        scoreBbParticipation(ipo, settings, stat, undefined, buildBbContext(ipo, ipos)).score,
      );
    }
    return map;
  }, [targetIpos, ipos, settings]);

  // 資金拘束の重なり（前受金が必要な口座×申込予定・申込済。終了済みの期間は除く）。
  const fundLockGroups = useMemo(
    () => groupOverlappingLocks(buildFundLockPeriods(targetIpos, brokers, bbState, todayIso)),
    [targetIpos, brokers, bbState, todayIso],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text">BB管理</h1>
        <Link
          href="/events"
          className="flex min-h-11 items-center text-xs text-accent-2 active:opacity-80"
        >
          上場後の予定はイベント一覧で確認できます →
        </Link>
      </div>

      <BbSummary counts={summary.counts} lockAmount={summary.lockAmount} />

      <FundLockCalendar groups={fundLockGroups} />

      {targetIpos.length === 0 ? (
        <EmptyState title="BB期間中・上場予定の銘柄がありません" />
      ) : (
        <div className="space-y-3">
          {targetIpos.map((ipo) => (
            <BbIpoCard
              key={ipo.code}
              ipo={ipo}
              brokers={brokers}
              priorities={prioritiesByCode.get(ipo.code) ?? []}
              bbScore={bbScoreByCode.get(ipo.code) ?? null}
              getEntry={getEntry}
              setStatus={setStatus}
            />
          ))}
        </div>
      )}

      {/* 申込記録のある全銘柄（上場済みを含む）の振り返り。記録0件なら非表示。 */}
      <MyRecords ipos={ipos} brokers={brokers} bbState={bbState} />
    </div>
  );
}
