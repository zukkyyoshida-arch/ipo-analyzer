"use client";

import type { MetricKey, Metrics, SeriesPoint, Granularity } from "@/lib/analytics";
import { metricDelta, metricValue } from "@/lib/analytics";
import { LineChart } from "./LineChart";
import { DetailButton } from "./DetailButton";
import { deltaTone, formatDelta, formatMetric } from "./format";

export const METRIC_TABS: { key: MetricKey; label: string }[] = [
  { key: "count", label: "上場社数" },
  { key: "avgReturn", label: "初値騰落率（平均）" },
  { key: "winRate", label: "初値勝率" },
  { key: "breakRate", label: "公募割れ率" },
];

const TONE_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function monthLabel(iso: string): string {
  return `${iso.slice(2, 4)}/${Number(iso.slice(5, 7))}`;
}

/** 指標タブ＋折れ線グラフ（アナリティクスの主役カード）。 */
export function MetricChartCard({
  current,
  previous,
  series,
  granularity,
  selected,
  onSelect,
  detailHref,
}: {
  current: Metrics;
  previous: Metrics | null;
  series: SeriesPoint[];
  granularity: Granularity;
  selected: MetricKey;
  onSelect: (k: MetricKey) => void;
  detailHref: string;
}) {
  const points = series.map((s) => ({
    label: granularity === "week" ? shortDate(s.start) : monthLabel(s.start),
    sub:
      granularity === "week"
        ? `${shortDate(s.start)}–${shortDate(s.end)}（${s.metrics.count} 社）`
        : `${s.start.slice(0, 4)}年${Number(s.start.slice(5, 7))}月（${s.metrics.count} 社）`,
    value: metricValue(s.metrics, selected),
  }));

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div role="tablist" className="flex overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {METRIC_TABS.map(({ key, label }) => {
          const active = key === selected;
          const delta = metricDelta(current, previous, key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(key)}
              className={`relative min-w-[132px] flex-1 shrink-0 px-4 pb-3 pt-4 text-left ${
                active ? "bg-surface" : "bg-surface-2"
              }`}
            >
              {active ? <span className="absolute inset-x-0 top-0 h-[3px] bg-accent" /> : null}
              <span className="block whitespace-nowrap text-[13px] text-muted">{label}</span>
              <span className="mt-1 block text-2xl tabular-nums text-text">
                {formatMetric(key, metricValue(current, key))}
              </span>
              <span className="mt-1 block min-h-4 whitespace-nowrap text-xs tabular-nums">
                {delta === null ? (
                  <span className="text-subtle">前期間比 —</span>
                ) : (
                  <>
                    <span className={TONE_CLASS[deltaTone(key, delta)]}>{formatDelta(key, delta)}</span>
                    <span className="ml-1 text-subtle">前期間比</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="p-4">
        <LineChart
          points={points}
          format={(v) => (selected === "count" ? `${Math.round(v)}` : `${Math.round(v)}%`)}
        />
        <DetailButton href={detailHref} />
      </div>
    </section>
  );
}
