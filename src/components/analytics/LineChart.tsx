"use client";

import { useState } from "react";

export interface ChartPoint {
  /** X 軸・ツールチップに出す日付ラベル。 */
  label: string;
  /** ツールチップの補足（期間など）。 */
  sub?: string;
  value: number | null;
}

const W = 100;
const H = 100;

function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / 3;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * 外部ライブラリ無しの SVG 折れ線。線と面は SVG（非等倍伸縮）、軸ラベル・点・ツールチップは HTML で重ねる。
 * 値が null の点は飛ばし、前後の点を直接つなぐ。
 */
export function LineChart({
  points,
  format,
  height = 180,
}: {
  points: ChartPoint[];
  format: (v: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);

  if (points.length === 0 || values.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
        この期間のデータはありません
      </div>
    );
  }

  const ticks = niceTicks(Math.min(0, ...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - ((v - yMin) / (yMax - yMin || 1)) * H;

  const valid = points.map((p, i) => ({ p, i })).filter(({ p }) => p.value !== null);
  // null（その週に上場なし等）は飛ばして前後の点をつなぐ（YouTube Studio と同じく線を途切れさせない）
  const line = valid
    .map(({ p, i }, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value as number).toFixed(2)}`)
    .join("");
  const first = valid[0];
  const last = valid[valid.length - 1];
  const baseY = y(Math.max(yMin, Math.min(0, yMax)));
  const area =
    valid.length > 1
      ? `M${x(first.i)},${baseY}` +
        valid.map(({ p, i }) => `L${x(i).toFixed(2)},${y(p.value as number).toFixed(2)}`).join("") +
        `L${x(last.i)},${baseY}Z`
      : "";

  const xLabelIdx = Array.from(
    new Set(
      [0, 0.33, 0.66, 1].map((f) => Math.round(f * (points.length - 1))),
    ),
  );

  function pick(clientX: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setActive(Math.round(f * (points.length - 1)));
  }

  const act = active !== null ? points[active] : null;

  return (
    <div className="select-none">
      <div className="flex">
        <div
          className="relative flex-1 touch-pan-y"
          style={{ height }}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={y(t)}
                y2={y(t)}
                className="stroke-chart-grid"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {area ? <path d={area} className="fill-chart-fill" /> : null}
            <path
              d={line}
              fill="none"
              className="stroke-chart-line"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {active !== null ? (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={0}
                y2={H}
                className="stroke-chart-grid"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {valid.length === 1 || (active !== null && act?.value !== null) ? (
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-chart-line"
              style={{
                left: `${x(active ?? first.i)}%`,
                top: `${y((active !== null ? act?.value : first.p.value) ?? 0)}%`,
              }}
            />
          ) : null}
          {act ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-24 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm"
              style={{ left: `${Math.min(80, Math.max(20, x(active as number)))}%` }}
            >
              <p className="text-muted">{act.sub ?? act.label}</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums text-text">
                {act.value === null ? "—" : format(act.value)}
              </p>
            </div>
          ) : null}
        </div>
        <div className="relative ml-2 w-10 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums text-subtle"
              style={{ top: `${y(t)}%` }}
            >
              {format(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mr-12 mt-1 h-4">
        {xLabelIdx.map((i) => (
          <span
            key={i}
            className={`absolute whitespace-nowrap text-[11px] tabular-nums text-subtle ${
              i === 0 ? "" : i === points.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
            }`}
            style={{ left: `${x(i)}%` }}
          >
            {points[i].label}
          </span>
        ))}
      </div>
    </div>
  );
}
