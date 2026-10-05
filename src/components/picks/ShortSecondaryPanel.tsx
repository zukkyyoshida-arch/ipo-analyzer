import type { ReactNode } from "react";
import Link from "next/link";
import { DetailButton } from "@/components/analytics/DetailButton";
import { formatMonthDay } from "@/lib/hot/file";
import type { CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import { SHORT_MAX_DAY, type ShortSecondaryPick, type ShortStage } from "@/lib/picks/shortSecondary";
import { CheckCountsInline, CheckpointChips, InstantCashChip } from "@/components/checkpoints/CheckpointParts";

// 行の格子。スマホは「順位・コード・銘柄・チェック」の下に目安の帯、1280px では目安を列に並べる
// （BB のピックアップと同じ組み方）。
const ROW_GRID =
  "grid grid-cols-[1rem_2.5rem_minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[1rem_2.5rem_minmax(0,1fr)_32rem_4.5rem]";

const METRIC_GRID = "grid-cols-3 lg:grid-cols-6";

function yen(v: number | null | undefined): string {
  return typeof v === "number" && v > 0 ? `${Math.round(v).toLocaleString("ja-JP")}円` : "—";
}

function StageLabel({ stage, listingDate }: { stage: ShortStage; listingDate: string }) {
  if (stage.kind === "eve") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text">
        上場前<span className="tabular-nums text-subtle">{formatMonthDay(listingDate)}上場</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-live" />
      上場 {stage.n} 日目
    </span>
  );
}

const DECISION_TONE = { skip: "text-ng", entry: "text-ok", wait: "text-muted" } as const;

/**
 * ホームの「ピックアップ」→「短期セカンダリ」。上場前日〜上場 5 日目の銘柄を、共通チェックのクリア数の多い順に並べる。
 * 判定は lib/picks/shortSecondary.ts（rankShortSecondary）で済ませ、ここは表示だけ。
 * @param picks rankShortSecondary の結果
 * @param thresholds 設定のしきい値（見出しの説明に使う）
 */
export function ShortSecondaryPanel({
  picks,
  thresholds: t,
}: {
  picks: ShortSecondaryPick[];
  thresholds: CheckpointThresholds;
}) {
  const eve = picks.filter((p) => p.stage.kind === "eve").length;

  return (
    <div>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-medium text-text">チェックのクリア数順</h2>
          {picks.length > 0 ? (
            <span className="text-xs tabular-nums text-subtle">
              上場前 {eve}・上場後 {picks.length - eve}
            </span>
          ) : null}
        </div>

        {picks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            明日上場する銘柄・上場 {SHORT_MAX_DAY} 日以内の銘柄はありません
          </p>
        ) : (
          <>
            <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
              <span className="col-span-3">銘柄</span>
              <span className={`hidden lg:col-start-4 lg:grid lg:gap-1 ${METRIC_GRID}`}>
                {["予想初値", "入る上限", "見送り", `利確 +${t.takeProfitPctSmall}%・+${t.takeProfitPct}%`, `損切り −${t.stopLossPct}%`, "買える株数"].map(
                  (label) => (
                    <span key={label} className="text-right">
                      {label}
                    </span>
                  ),
                )}
              </span>
              <span className="col-start-4 text-right lg:col-start-5">チェック</span>
            </div>
            <ol>
              {picks.map((pick, i) => (
                <ShortRow key={pick.ipo.code} rank={i + 1} pick={pick} t={t} />
              ))}
            </ol>
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
              <p>
                入る上限は予想初値の {t.entryBelowForecastRatio} 倍、見送りは {t.skipAboveForecastRatio} 倍。初値が公募割れ・公募の +5% 未満・
                +{t.skipAboveOfferingPct}% 超のときも見送りにしています。
              </p>
              <p>
                利確・損切りは初値（上場前は予想初値）から計算。買える株数は投入資金 {t.capitalYen.toLocaleString("ja-JP")}円 ×{" "}
                {t.maxPerStockPct}% を 100 株単位で切り捨てた数です。上場 5 日以内は天井になりやすい傾向があります。
              </p>
              <p>判断材料であり売買推奨ではありません。</p>
            </div>
          </>
        )}
        <DetailButton href="/settings#thresholds" label="しきい値と資金" />
      </section>
    </div>
  );
}

function ShortRow({ rank, pick, t }: { rank: number; pick: ShortSecondaryPick; t: CheckpointThresholds }) {
  const { ipo, exits, forecast, sizing } = pick;
  const metrics: { label: string; value: ReactNode }[] = [
    {
      label: "予想初値",
      value: forecast ? yen(forecast.center) : "—",
    },
    { label: "入る上限", value: <span className="text-ok">{yen(pick.entryMax)}</span> },
    { label: "見送り", value: pick.skipAbove ? <span className="text-ng">{yen(pick.skipAbove)}〜</span> : "—" },
    {
      label: `利確 +${t.takeProfitPctSmall}%・+${t.takeProfitPct}%`,
      value: exits ? `${exits.takeProfitSmall.toLocaleString("ja-JP")}・${yen(exits.takeProfit)}` : "—",
    },
    { label: `損切り −${t.stopLossPct}%`, value: exits ? yen(exits.stopLoss) : "—" },
    {
      label: "買える株数",
      value: sizing ? (sizing.shares > 0 ? `${sizing.shares.toLocaleString("ja-JP")}株` : "資金不足") : "—",
    },
  ];

  return (
    <li className="border-b border-border last:border-b-0">
      <Link href={`/ipo/${ipo.code}`} prefetch={false} className={`${ROW_GRID} items-center py-3 active:opacity-80`}>
        <span className="col-start-1 row-start-1 text-center text-sm tabular-nums text-muted">{rank}</span>
        <span className="col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {ipo.code}
        </span>
        <span className="col-start-3 row-start-1 min-w-0">
          <span className="block truncate text-sm text-text">{ipo.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
            <StageLabel stage={pick.stage} listingDate={ipo.listingDate} />
            <span className={DECISION_TONE[pick.decision.kind]}>{pick.decision.text}</span>
            {forecast ? (
              <span className="tabular-nums">
                80% {forecast.low80.toLocaleString("ja-JP")}〜{forecast.high80.toLocaleString("ja-JP")}円
              </span>
            ) : null}
          </span>
          {pick.chips.length > 0 || pick.instantCash ? (
            <span className="mt-1 flex flex-wrap gap-1">
              <CheckpointChips chips={pick.chips} />
              <InstantCashChip status={pick.instantCash} />
            </span>
          ) : null}
          {pick.note ? <span className="mt-1 block text-[11px] text-subtle">{pick.note}</span> : null}
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-text">
            {pick.checks.counts.pass}
            <span className="text-xs text-subtle">/{pick.checks.items.length}</span>
          </span>
          <CheckCountsInline counts={pick.checks.counts} className="mt-1" />
        </span>
        <span
          className={`col-span-4 col-start-1 row-start-2 mt-2 grid ${METRIC_GRID} gap-1 rounded-lg bg-surface-2 px-2 py-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:bg-transparent lg:p-0`}
        >
          {metrics.map((m) => (
            <span key={m.label} className="flex min-w-0 flex-col lg:items-end">
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
