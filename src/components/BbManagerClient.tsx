"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import { useBbState } from "@/hooks/useUserData";
import { BbStatusSelect } from "./BbStatusSelect";
import { estimatedLockAmount, formatDate, STATUS_LABELS } from "@/lib/format";

// 資金拘束の対象とするステータス（申込済・当選）。
const LOCK_STATUSES: BbStatus[] = ["applied", "won"];

export function BbManagerClient({
  ipos,
  brokers,
}: {
  ipos: Ipo[];
  brokers: Broker[];
}) {
  const { bbState, getEntry, setStatus } = useBbState();

  // ステータス別集計と資金拘束目安合計を算出。
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
    for (const ipo of ipos) {
      for (const broker of brokers) {
        const entry = bbState[ipo.code]?.[broker.id];
        if (!entry) {
          counts.none += 1;
          continue;
        }
        counts[entry.status] += 1;
        if (LOCK_STATUSES.includes(entry.status)) {
          lockAmount += estimatedLockAmount(ipo);
        }
      }
    }
    return { counts, lockAmount };
  }, [bbState, ipos, brokers]);

  // BB対象（上場前・受付中）を優先表示。
  const activeIpos = ipos.filter(
    (i) => i.status === "upcoming" || i.status === "bb_open",
  );
  const otherIpos = ipos.filter(
    (i) => i.status !== "upcoming" && i.status !== "bb_open",
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">BB管理</h1>
        <p className="mt-1 text-xs text-slate-500">
          証券会社ごとの申込状況を管理します。資金拘束目安は「申込済・当選」の
          公開価格（未定なら仮条件上限）×100株の合計です。
        </p>
      </div>

      {/* 集計 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="申込予定" value={summary.counts.planned} />
        <SummaryCard label="申込済" value={summary.counts.applied} />
        <SummaryCard label="当選" value={summary.counts.won} highlight />
        <SummaryCard label="補欠" value={summary.counts.waitlist} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs text-slate-500">資金拘束目安（合計）</div>
        <div className="mt-1 text-2xl font-bold text-slate-900">
          {summary.lockAmount.toLocaleString()}
          <span className="ml-1 text-base font-normal text-slate-500">円</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          申込済・当選のステータスを対象に集計。
        </p>
      </section>

      {/* BB対象銘柄 */}
      <BbSection
        title="BB対象（上場予定・受付中）"
        ipos={activeIpos}
        brokers={brokers}
        getEntry={getEntry}
        setStatus={setStatus}
        emptyText="現在、上場予定・受付中の銘柄はありません。"
      />

      {/* その他（上場済等） */}
      {otherIpos.length > 0 && (
        <BbSection
          title="その他の銘柄"
          ipos={otherIpos}
          brokers={brokers}
          getEntry={getEntry}
          setStatus={setStatus}
          emptyText=""
        />
      )}
    </div>
  );
}

function BbSection({
  title,
  ipos,
  brokers,
  getEntry,
  setStatus,
  emptyText,
}: {
  title: string;
  ipos: Ipo[];
  brokers: Broker[];
  getEntry: (code: string, brokerId: string) => { status: BbStatus };
  setStatus: (code: string, brokerId: string, status: BbStatus) => void;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold text-slate-800">{title}</h2>
      {ipos.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {ipos.map((ipo) => (
            <div
              key={ipo.code}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <Link
                  href={`/ipo/${ipo.code}`}
                  className="font-medium text-slate-800 hover:underline"
                >
                  {ipo.name}
                </Link>
                <span className="text-xs text-slate-400">
                  {STATUS_LABELS[ipo.status]}・{formatDate(ipo.listingDate)}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {brokers.map((broker) => {
                  const entry = getEntry(ipo.code, broker.id);
                  const isLead = broker.name === ipo.leadUnderwriter;
                  const inSyndicate = ipo.underwriters.includes(broker.name);
                  return (
                    <div
                      key={broker.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-slate-600">
                        {broker.name}
                        {isLead && (
                          <span className="ml-1.5 text-[10px] font-semibold text-slate-900">
                            [主幹事]
                          </span>
                        )}
                        {!isLead && inSyndicate && (
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            [引受]
                          </span>
                        )}
                      </span>
                      <BbStatusSelect
                        value={entry.status}
                        onChange={(status) =>
                          setStatus(ipo.code, broker.id, status)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        highlight
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${highlight ? "text-emerald-700" : "text-slate-900"}`}
      >
        {value}
        <span className="ml-0.5 text-xs font-normal text-slate-400">件</span>
      </div>
    </div>
  );
}
