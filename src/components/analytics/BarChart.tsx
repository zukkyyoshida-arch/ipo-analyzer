"use client";

import { useState, type KeyboardEvent } from "react";
import { barDomain, barExtent, cleanValue, labelIndices, yPercent } from "./barScale";

export interface BarPoint {
  /** X 軸に出す期間ラベル。 */
  label: string;
  /** ツールチップの見出し（期間・社数など）。 */
  sub?: string;
  /** 棒の値。null と非有限（NaN / Infinity）は「値なし」で棒を描かない（0 とは区別する）。 */
  value: number | null;
  /** value が null のときにツールチップへ出す理由（例: 上場なし）。 */
  note?: string;
}

const W = 100;
const H = 100;

/**
 * 外部ライブラリ無しの縦棒グラフ（期間ごとの集計値用）。
 * 目盛り線は SVG（非等倍伸縮＋non-scaling-stroke）、棒・基準線・軸ラベル・ツールチップは HTML で重ねる。
 * 棒を HTML にしているのは、幅の上限（24px）と角丸を画面幅に関係なく崩さず保つため。
 * - 棒は必ず 0 の基準線から伸ばす。signed のときはプラスを up 色・マイナスを down 色で描き分ける
 * - 値が 0 の期間は基準線上に 2px の印を描き、null・非有限（値なし）の期間は何も描かない
 * - 絶対値が 1e-6 未満の値は 0 として扱う（浮動小数の誤差で目盛りや棒が崩れないように）
 */
export function BarChart({
  points,
  formatTick,
  formatValue,
  signed = false,
  integer = false,
  height = 180,
  ariaLabel,
}: {
  points: BarPoint[];
  /** 縦軸目盛りの表示。 */
  formatTick: (v: number) => string;
  /** ツールチップ・読み上げ用の値の表示。 */
  formatValue: (v: number) => string;
  /** 正負のある値か（0 の基準線を境にプラス／マイナスで色を分ける）。 */
  signed?: boolean;
  /** 件数など整数の値か（目盛りを整数刻みにする）。 */
  integer?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  // 描画・ツールチップ・読み上げは全部この値を使う。NaN / Infinity は null（棒なし）、ごく小さい値は 0
  const values = points.map((p) => cleanValue(p.value));
  const domain = barDomain(values, { integer });

  if (points.length === 0 || domain === null) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
        この期間のデータはありません
      </div>
    );
  }

  const n = points.length;
  const { ticks, min, max } = domain;
  const baseline = yPercent(0, min, max);
  const center = (i: number) => ((i + 0.5) / n) * 100;
  const labels = labelIndices(n);

  function pick(clientX: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const f = (clientX - rect.left) / (rect.width || 1);
    setActive(Math.min(n - 1, Math.max(0, Math.floor(f * n))));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const cur = active ?? n - 1;
    const next =
      e.key === "ArrowLeft"
        ? Math.max(0, cur - 1)
        : e.key === "ArrowRight"
          ? Math.min(n - 1, cur + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  }

  function barColor(v: number): string {
    if (!signed) return "bg-chart-line";
    if (v > 0) return "bg-up";
    if (v < 0) return "bg-down";
    return "bg-subtle";
  }

  const act = active !== null ? points[active] : null;
  const actValue = active !== null ? values[active] : null;

  return (
    <div className="select-none">
      <div className="flex">
        <div
          className="relative flex-1 touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          style={{ height }}
          role="group"
          aria-label={`${ariaLabel}（左右キーで期間を移動）`}
          tabIndex={0}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
        >
          {active !== null ? (
            <div
              className="pointer-events-none absolute inset-y-0 bg-surface-2"
              style={{ left: `${(active / n) * 100}%`, width: `${100 / n}%` }}
            />
          ) : null}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            {ticks
              .filter((t) => t !== 0)
              .map((t) => (
                <line
                  key={t}
                  x1={0}
                  x2={W}
                  y1={yPercent(t, min, max)}
                  y2={yPercent(t, min, max)}
                  className="stroke-chart-grid"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex" aria-hidden>
            {values.map((v, i) => {
              if (v === null) return <div key={i} className="h-full flex-1" />;
              const { baseline: b, length, negative } = barExtent(v, min, max);
              return (
                <div key={i} className="relative h-full flex-1">
                  <div
                    className={`absolute left-1/2 -translate-x-1/2 ${barColor(v)} ${
                      negative ? "rounded-b-[4px]" : "rounded-t-[4px]"
                    }`}
                    style={{
                      width: "64%",
                      maxWidth: 24,
                      minWidth: 1,
                      minHeight: 2,
                      height: `${length}%`,
                      ...(negative ? { top: `${b}%` } : { bottom: `${100 - b}%` }),
                    }}
                  />
                </div>
              );
            })}
          </div>
          {/* 0 の基準線（棒の根元）。目盛り線より一段濃くし、棒の上に重ねる */}
          <div
            className="pointer-events-none absolute inset-x-0 h-px -translate-y-1/2 bg-subtle"
            style={{ top: `${baseline}%` }}
            aria-hidden
          />
          {act ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-24 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm"
              style={{ left: `${Math.min(80, Math.max(20, center(active as number)))}%` }}
            >
              <p className="whitespace-nowrap text-muted">{act.sub ?? act.label}</p>
              {actValue === null ? (
                <p className="mt-0.5 text-sm text-muted">{act.note ?? "—"}</p>
              ) : (
                <p className="mt-0.5 text-sm font-medium tabular-nums text-text">
                  {formatValue(actValue)}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="relative ml-2 w-10 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums text-subtle"
              style={{ top: `${yPercent(t, min, max)}%` }}
            >
              {formatTick(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mr-12 mt-1 h-4" aria-hidden>
        {labels.map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-subtle"
            style={{ left: `${center(i)}%` }}
          >
            {points[i].label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.sub ?? p.label}</th>
              <td>{values[i] === null ? (p.note ?? "値なし") : formatValue(values[i] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
