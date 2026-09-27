import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PriceChange } from "@/components/ui/PriceChange";
import {
  EVENT_STAT_KINDS,
  EVENT_STAT_LABELS,
  EVENT_WEAK_SAMPLE_THRESHOLD,
  eventSampleNote,
  eventYearsRange,
  getEventStats,
  type EventStat,
  type EventStatsFile,
} from "@/lib/events/eventStats";

/**
 * /events 用「イベント前後の実績（参考情報）」カード。
 * 過去IPOのロックアップ解除・1.5倍解除到達・初回決算の前後リターンを機械的に集計した値を表示する。
 * 操作状態を持たないため "use client" は付けない。stats 省略時は同梱の event-stats.json を使う。
 */
export function EventStatsNote({ stats }: { stats?: EventStatsFile }) {
  const data = stats ?? getEventStats();
  const rows = EVENT_STAT_KINDS.map((kind) => ({ kind, stat: data.kinds[kind] }));

  if (rows.every((r) => !r.stat || r.stat.sampleCount === 0)) {
    return <EmptyState title="イベント前後の実績データがまだありません（参考情報）" />;
  }

  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">
        イベント前後の実績（参考情報）
      </p>
      <p className="mt-1 text-xs text-muted">
        イベント日の終値から20営業日後までの騰落率の実績分布（分割補正済み）
      </p>

      <div className="mt-2 divide-y divide-border">
        {rows.map(({ kind, stat }) => (
          <EventStatRow key={kind} label={EVENT_STAT_LABELS[kind]} stat={stat} />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        上場済み銘柄の値動きを機械的に集計した値です（価格データは
        {data.asOf || "—"}時点、上場を続けている銘柄のみで集計）。母数
        {EVENT_WEAK_SAMPLE_THRESHOLD}件未満は目安として弱く、将来の値動きを示すものではありません。
      </p>
    </Card>
  );
}

function EventStatRow({ label, stat }: { label: string; stat?: EventStat }) {
  const note = stat ? eventSampleNote(stat.sampleCount) : null;
  const weak = !!stat && stat.sampleCount < EVENT_WEAK_SAMPLE_THRESHOLD;
  const years = stat ? eventYearsRange(stat) : "";

  return (
    <div className="py-3">
      <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className={`text-[11px] ${weak ? "font-medium text-warn" : "text-muted"}`}>
          {note ?? "実績なし"}
          {note && years ? `・${years}` : ""}
        </p>
      </div>
      {stat && stat.sampleCount > 0 ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="後20日 中央値">
            <PriceChange value={stat.medianAfter20} />
          </Stat>
          <Stat label="後20日 上昇割合">
            {stat.winRateAfter20 === null ? "—" : `${stat.winRateAfter20.toFixed(0)}%`}
          </Stat>
          <Stat label="前20日 平均">
            <PriceChange value={stat.meanBefore20} />
          </Stat>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-text tabular-nums">{children}</p>
    </div>
  );
}
