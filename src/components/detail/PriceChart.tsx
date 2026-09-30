"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type CandlestickData,
  type ChartOptions,
  type DeepPartial,
  type HistogramData,
  type IChartApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { computeMovingAverage } from "@/lib/chart/movingAverage";
import {
  CHART_PERIODS,
  extendRangeWithReferences,
  formatChartPrice,
  formatVolumeJa,
  periodStartIndex,
  withAlpha,
  type ChartPeriod,
  type OhlcBar,
} from "@/lib/chart/ohlc";

// TradingView 公式の lightweight-charts（Apache-2.0）で描く銘柄詳細の株価チャート。
// ブラウザ専用（canvas・ResizeObserver を使う）。PriceCard から next/dynamic の ssr:false で読み込む。
//
// 帰属表示（ライセンスの NOTICE。tradingview.com へのリンクはチャート内の TradingView ロゴで満たす）:
//   TradingView Lightweight Charts™
//   Copyright (c) 2026 TradingView, Inc. https://www.tradingview.com/

/** 公開価格・初値などの水平線。 */
export interface PriceReferenceLine {
  label: string;
  price: number;
  tone: "accent" | "accent-2";
}

/** 移動平均の日数。 */
const MA_WINDOW = 25;
/** 最新足の右に空ける本数。 */
const RIGHT_OFFSET_BARS = 3;
/** 足が少ない銘柄でローソクが極端に太らないよう、足の間隔の上限（px）。 */
const MAX_BAR_SPACING = 24;
/** 出来高ヒストグラムを置くペイン（0 が価格）。 */
const VOLUME_PANE = 1;
/** 既定の表示期間。375px 幅でも足が潰れない長さ。 */
const DEFAULT_PERIOD: ChartPeriod = "3M";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** YYYY-MM-DD → 2026/09/26(金) */
function formatLegendDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${iso.replaceAll("-", "/")}(${w})`;
}

interface Palette {
  surface: string;
  surface2: string;
  border: string;
  grid: string;
  muted: string;
  subtle: string;
  up: string;
  down: string;
  accent: string;
  accent2: string;
}

/** globals.css のトークンを実際の色文字列に解決する（canvas は var() を解釈できないため）。 */
function readPalette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--surface", "#282828"),
    surface2: v("--surface-2", "#373737"),
    border: v("--border", "#3f3f3f"),
    grid: v("--chart-grid", "#3f3f3f"),
    muted: v("--text-muted", "#aaaaaa"),
    subtle: v("--text-subtle", "#717171"),
    up: v("--up", "#2ba640"),
    down: v("--down", "#ff4e45"),
    accent: v("--accent", "#3ea6ff"),
    accent2: v("--accent-2", "#9aa0a6"),
  };
}

function themedChartOptions(p: Palette): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: p.surface },
      textColor: p.muted,
      panes: { separatorColor: p.border },
    },
    grid: {
      vertLines: { color: withAlpha(p.grid, 0.5) },
      horzLines: { color: withAlpha(p.grid, 0.5) },
    },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
    crosshair: {
      vertLine: { color: p.subtle, labelBackgroundColor: p.surface2 },
      horzLine: { color: p.subtle, labelBackgroundColor: p.surface2 },
    },
  };
}

function volumeData(bars: readonly OhlcBar[], p: Palette): HistogramData<Time>[] {
  const up = withAlpha(p.up, 0.45);
  const down = withAlpha(p.down, 0.45);
  return bars.map((b) => ({
    time: b.date,
    value: b.volume ?? 0,
    color: b.close >= b.open ? up : down,
  }));
}

/**
 * TradingView 風のローソク足チャート（出来高・25日移動平均・公開価格/初値の水平線・十字カーソル凡例・期間切替）。
 * - ドラッグで横スクロール、ピンチ/ホイールで拡大縮小。スマホの縦スワイプはページのスクロールに渡す
 * - bars は日付昇順・重複なし（toOhlcBars 済み）で1本以上あること
 */
export function PriceChart({
  bars,
  referenceLines,
  listingDate,
}: {
  bars: readonly OhlcBar[];
  referenceLines: readonly PriceReferenceLine[];
  /** 上場日（YYYY-MM-DD）。最初の足が上場日なら「上場」マーカーを付ける */
  listingDate?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [selection, setSelection] = useState<{ period: ChartPeriod; nonce: number }>({
    period: DEFAULT_PERIOD,
    nonce: 0,
  });
  // 十字カーソルが指している足（null なら最新足を凡例に出す）。
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const ma = useMemo(
    () =>
      computeMovingAverage(
        bars.map((b) => b.close),
        MA_WINDOW,
      ),
    [bars],
  );
  const hasMa = ma.some((v) => v !== null);

  // チャート本体の生成と破棄。データが変わったら作り直す。
  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    let palette = readPalette(container);
    const refPrices = referenceLines.map((r) => r.price);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        fontSize: 11,
        fontFamily: getComputedStyle(container).fontFamily,
        // ライセンス（NOTICE の帰属表示）を満たすため TradingView のロゴは既定どおり表示する。
        attributionLogo: true,
        // 出来高は下段の別ペイン。境界のドラッグはスマホのスクロールと紛らわしいので無効。
        panes: { enableResize: false },
      },
      rightPriceScale: {
        // 上は凡例（3行）ぶん空ける。
        scaleMargins: { top: 0.25, bottom: 0.06 },
      },
      timeScale: {
        rightOffset: RIGHT_OFFSET_BARS,
        maxBarSpacing: MAX_BAR_SPACING,
        fixLeftEdge: true,
        // 画面回転・幅変更でも選んだ期間の範囲を保つ（既定は足の間隔を保って左側が切れる）。
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: "ja-JP",
        dateFormat: "yyyy/MM/dd",
      },
      // 横ドラッグ・ピンチはチャートが受け、縦スワイプはページのスクロールに渡す。
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });
    // 色は applyOptions で深くマージする（createChart の引数に展開すると layout 等が丸ごと上書きされる）。
    chart.applyOptions(themedChartOptions(palette));
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      borderVisible: false,
      priceFormat: { type: "custom", formatter: formatChartPrice, minMove: 0.1 },
      // 公開価格・初値の線が近くにあるときは画面内に収める（遠すぎる線は足が潰れるので含めない）。
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const res = base();
        if (!res || !res.priceRange || refPrices.length === 0) return res;
        return { ...res, priceRange: extendRangeWithReferences(res.priceRange, refPrices) };
      },
    });
    candleSeries.setData(
      bars.map<CandlestickData<Time>>((b) => ({
        time: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // 出来高は TradingView と同じく下段の別ペイン（価格の目盛りと重ならない）。
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "custom", formatter: formatVolumeJa, minMove: 1 },
        lastValueVisible: false,
        priceLineVisible: false,
      },
      VOLUME_PANE,
    );
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
    volumeSeries.setData(volumeData(bars, palette));
    const [pricePane, volumePane] = chart.panes();
    pricePane?.setStretchFactor(3);
    volumePane?.setStretchFactor(1);

    const maSeries = chart.addSeries(LineSeries, {
      color: palette.muted,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: "custom", formatter: formatChartPrice, minMove: 0.1 },
    });
    maSeries.setData(
      bars.flatMap<LineData<Time>>((b, i) => {
        const v = ma[i];
        return v === null ? [] : [{ time: b.date, value: v }];
      }),
    );

    const priceLines = referenceLines.map((r) =>
      candleSeries.createPriceLine({
        price: r.price,
        color: r.tone === "accent" ? palette.accent : palette.accent2,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: r.label,
      }),
    );

    // 最初の足が上場日なら「上場」の印を付ける（Yahoo の穴埋め行を捨てた結果ずれた日には付けない）。
    const listingMarker = (color: string): SeriesMarker<Time>[] => [
      { time: bars[0].date, position: "belowBar", shape: "arrowUp", color, text: "上場" },
    ];
    const markers =
      listingDate && bars[0].date === listingDate
        ? createSeriesMarkers(candleSeries, listingMarker(palette.accent))
        : null;

    // 十字カーソルの足は time（setData に渡した YYYY-MM-DD がそのまま返る）で引く。
    const indexByDate = new Map(bars.map((b, i) => [b.date, i]));
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const idx =
        param.point !== undefined && typeof param.time === "string"
          ? indexByDate.get(param.time)
          : undefined;
      setHoverIndex(idx ?? null);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    // ライト/ダーク切り替え（OS 設定・<html data-theme>）に追従する。
    const applyTheme = () => {
      palette = readPalette(container);
      chart.applyOptions(themedChartOptions(palette));
      candleSeries.applyOptions({
        upColor: palette.up,
        downColor: palette.down,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
      });
      maSeries.applyOptions({ color: palette.muted });
      volumeSeries.setData(volumeData(bars, palette));
      priceLines.forEach((line, i) =>
        line.applyOptions({
          color: referenceLines[i].tone === "accent" ? palette.accent : palette.accent2,
        }),
      );
      markers?.setMarkers(listingMarker(palette.accent));
    };
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", applyTheme);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      media.removeEventListener("change", applyTheme);
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chartRef.current = null;
      chart.remove();
    };
  }, [bars, ma, referenceLines, listingDate]);

  // 期間ボタン: その期間の足が収まるよう表示範囲を合わせる（同じボタンの再押下でも拡大縮小をリセット）。
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || bars.length === 0) return;
    const months = CHART_PERIODS.find((p) => p.value === selection.period)?.months ?? 3;
    const start = periodStartIndex(bars, months);
    chart.timeScale().setVisibleLogicalRange({
      from: start - 0.5,
      to: bars.length - 1 + RIGHT_OFFSET_BARS,
    });
  }, [bars, selection]);

  const index = hoverIndex !== null && hoverIndex < bars.length ? hoverIndex : bars.length - 1;
  const current = bars[index];
  const prevClose = index > 0 ? bars[index - 1].close : null;
  const change = prevClose !== null ? current.close - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;
  const currentMa = ma[index];
  // TradingView と同じく、始高安終はその足の陽線/陰線の色で出す。
  const ohlcTone = current.close >= current.open ? "text-up" : "text-down";
  const last = bars[bars.length - 1];
  const ariaLabel = `ローソク足チャート。${formatLegendDate(bars[0].date)}から${formatLegendDate(last.date)}までの${bars.length}日分、直近終値${formatChartPrice(last.close)}円`;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <div role="group" aria-label="表示期間" className="flex gap-1">
        {CHART_PERIODS.map((p) => {
          const active = p.value === selection.period;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => setSelection((s) => ({ period: p.value, nonce: s.nonce + 1 }))}
              className={`h-9 min-w-11 rounded-md px-2 text-xs font-medium tabular-nums transition-colors active:opacity-80 ${
                active ? "bg-surface-2 text-text" : "text-muted"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="relative mt-1">
        <div
          ref={containerRef}
          role="img"
          aria-label={ariaLabel}
          className="h-[320px] w-full sm:h-[400px]"
        />
        {/* TradingView 風の凡例（十字カーソルの足。未操作時は最新足） */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1 left-1 z-10 max-w-[calc(100%-4rem)] text-[11px] leading-4 tabular-nums"
        >
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted">{formatLegendDate(current.date)}</span>
            {change !== null && changePct !== null ? (
              <span className={change >= 0 ? "text-up" : "text-down"}>
                {change >= 0 ? "+" : ""}
                {formatChartPrice(change)} ({change >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
            ) : null}
          </p>
          <p className="flex flex-wrap gap-x-2">
            <LegendValue label="始" value={formatChartPrice(current.open)} className={ohlcTone} />
            <LegendValue label="高" value={formatChartPrice(current.high)} className={ohlcTone} />
            <LegendValue label="安" value={formatChartPrice(current.low)} className={ohlcTone} />
            <LegendValue label="終" value={formatChartPrice(current.close)} className={ohlcTone} />
          </p>
          <p className="flex flex-wrap gap-x-2">
            <LegendValue label="出来高" value={formatVolumeJa(current.volume)} className="text-text" />
            {currentMa !== null ? (
              <LegendValue label={`MA${MA_WINDOW}`} value={formatChartPrice(currentMa)} className="text-text" />
            ) : null}
          </p>
        </div>
      </div>

      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {hasMa ? (
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block w-3.5 border-t-[1.5px] border-muted" />
            {MA_WINDOW}日移動平均
          </li>
        ) : null}
        {referenceLines.map((r) => (
          <li key={r.label} className="flex items-center gap-1">
            <span
              aria-hidden
              className={`inline-block w-3.5 border-t-[1.5px] border-dashed ${
                r.tone === "accent" ? "border-accent" : "border-accent-2"
              }`}
            />
            {r.label} <span className="tabular-nums text-text">{formatChartPrice(r.price)}円</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LegendValue({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{label}</span> <span className={className}>{value}</span>
    </span>
  );
}
