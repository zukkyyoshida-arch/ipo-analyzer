"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist, useBbState, useNotes } from "@/hooks/useUserData";
import { scoreIpo } from "@/lib/scoring";
import { ScoreBadge } from "./ScoreBadge";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ScoreNote } from "./Disclaimer";
import { WatchStar } from "./WatchStar";
import { BbStatusSelect } from "./BbStatusSelect";
import { SBI_BROKER_ID } from "@/data/brokers";
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  formatDate,
  formatYen,
  formatOku,
  initialReturnRate,
} from "@/lib/format";

export function IpoDetailClient({
  ipo,
  brokers,
  similarIpos,
}: {
  ipo: Ipo;
  brokers: Broker[];
  similarIpos: Ipo[];
}) {
  const { settings } = useSettings();
  const { isWatched, toggle } = useWatchlist();
  const { getEntry, setStatus, setMemo } = useBbState();
  const { getNote, setNote } = useNotes();

  const score = useMemo(() => scoreIpo(ipo, settings), [ipo, settings]);
  const downsideItem = score.supplyDemand.items.find(
    (i) => i.key === "downside",
  );

  return (
    <div className="space-y-6">
      {/* ヘッダ */}
      <div>
        <Link
          href="/"
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← 一覧に戻る
        </Link>
        <div className="mt-2 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE_CLASS[ipo.status]}`}
              >
                {STATUS_LABELS[ipo.status]}
              </span>
              <span className="text-xs text-slate-400">{ipo.code}</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              {ipo.name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {ipo.market}・{ipo.sector}
            </p>
          </div>
          <WatchStar
            active={isWatched(ipo.code)}
            onToggle={() => toggle(ipo.code)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ipo.theme.map((t) => (
            <span
              key={t}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
            >
              {t}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {ipo.description}
        </p>
      </div>

      {/* スコア2軸 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">スコア（2軸）</h2>
          <ScoreNote />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ScoreBadge score={score.supplyDemand.score} label="需給タイト度" />
          <ScoreBadge score={score.fundamental.score} label="ファンダ" />
        </div>
        {downsideItem && downsideItem.points < 0 && (
          <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            公募割れ注意フラグ: {downsideItem.reason}
          </p>
        )}
      </section>

      {/* 基本情報テーブル */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">基本情報</h2>
        <InfoTable ipo={ipo} />
      </section>

      {/* スコア内訳 */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-800">スコア内訳</h2>
        <ScoreBreakdown title="需給スコア" axis={score.supplyDemand} />
        <ScoreBreakdown title="ファンダスコア" axis={score.fundamental} />
      </section>

      {/* BB申込状況 */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">
          BB申込状況（証券会社別）
        </h2>
        <div className="space-y-2">
          {brokers.map((broker) => {
            const entry = getEntry(ipo.code, broker.id);
            const isSbi = broker.id === SBI_BROKER_ID;
            const isLead = broker.name === ipo.leadUnderwriter;
            const inSyndicate = ipo.underwriters.includes(broker.name);
            return (
              <div
                key={broker.id}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-800">
                      {broker.name}
                    </span>
                    {isLead && (
                      <span className="ml-1.5 rounded bg-slate-900 px-1 py-0.5 text-[10px] font-semibold text-white">
                        主幹事
                      </span>
                    )}
                    {!isLead && inSyndicate && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
                        引受
                      </span>
                    )}
                  </div>
                  <BbStatusSelect
                    value={entry.status}
                    onChange={(status) =>
                      setStatus(ipo.code, broker.id, status)
                    }
                  />
                </div>
                {isSbi && (
                  <div className="mt-2">
                    <label className="text-[11px] text-slate-500">
                      チャレンジポイント投入数メモ
                    </label>
                    <input
                      type="text"
                      value={entry.memo ?? ""}
                      onChange={(e) =>
                        setMemo(ipo.code, broker.id, e.target.value)
                      }
                      placeholder="例: 300pt 投入"
                      className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* メモ */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">メモ</h2>
        <textarea
          value={getNote(ipo.code)}
          onChange={(e) => setNote(ipo.code, e.target.value)}
          placeholder="この銘柄についてのメモ（自動保存）"
          rows={4}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-slate-400">入力内容は自動保存されます。</p>
      </section>

      {/* 類似IPO実績 */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">類似IPOの実績</h2>
        {similarIpos.length === 0 ? (
          <p className="text-sm text-slate-500">
            登録された類似IPOはありません。
          </p>
        ) : (
          <div className="space-y-2">
            {similarIpos.map((s) => {
              const rate = initialReturnRate(s);
              return (
                <Link
                  key={s.code}
                  href={`/ipo/${s.code}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm hover:shadow-sm"
                >
                  <div>
                    <span className="font-medium text-slate-800">
                      {s.name}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      {formatDate(s.listingDate)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">
                      公開 {formatYen(s.offeringPrice)} → 初値{" "}
                      {formatYen(s.initialPrice)}
                    </div>
                    {rate !== null && (
                      <div
                        className={`text-sm font-bold ${rate >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {rate >= 0 ? "+" : ""}
                        {rate.toFixed(1)}%
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoTable({ ipo }: { ipo: Ipo }) {
  const rows: [string, string][] = [
    ["上場日", formatDate(ipo.listingDate)],
    ["BB期間", `${formatDate(ipo.bbPeriod.start)}〜${formatDate(ipo.bbPeriod.end)}`],
    ["当選発表日", formatDate(ipo.allotmentDate)],
    [
      "購入期間",
      `${formatDate(ipo.purchasePeriod.start)}〜${formatDate(ipo.purchasePeriod.end)}`,
    ],
    ["想定価格", formatYen(ipo.assumedPrice)],
    ["仮条件", `${formatYen(ipo.priceRange.low)}〜${formatYen(ipo.priceRange.high)}`],
    ["公開価格", formatYen(ipo.offeringPrice)],
    ["吸収金額(OA込)", formatOku(ipo.absorptionAmount)],
    ["想定時価総額", formatOku(ipo.marketCap)],
    ["公募株数", `${ipo.publicShares.toLocaleString()}株`],
    ["売出株数", `${ipo.saleShares.toLocaleString()}株`],
    ["OA株数", `${ipo.overAllotment.toLocaleString()}株`],
    ["放出比率", `${ipo.offeringRatio}%`],
    ["VC比率", `${ipo.vcRatio}%`],
    [
      "ロックアップ",
      `${ipo.lockup.days}日${ipo.lockup.hasPriceRelease ? "・1.5倍解除あり" : ""}（カバレッジ${ipo.lockup.coverage}%）`,
    ],
    ["主幹事", ipo.leadUnderwriter],
    ["引受幹事", ipo.underwriters.join("・")],
    ["売上高", `${ipo.financials.revenue.toLocaleString()}百万円`],
    ["売上成長率", `${ipo.financials.revenueGrowth}%`],
    [
      "営業損益",
      `${ipo.financials.operatingProfit.toLocaleString()}百万円（${ipo.financials.isProfitable ? "黒字" : "赤字"}）`,
    ],
    ["PER", ipo.per === null ? "算出不能" : `${ipo.per}倍`],
    ["PSR", ipo.psr === null ? "算出不能" : `${ipo.psr}倍`],
    ["初値", formatYen(ipo.initialPrice)],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th className="w-2/5 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">
                {label}
              </th>
              <td className="px-3 py-2 text-slate-800">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
