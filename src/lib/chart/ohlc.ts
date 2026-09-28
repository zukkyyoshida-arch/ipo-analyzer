// 株価チャート（lightweight-charts）へ渡す前のデータ整形・表示用フォーマットの純関数群。
// ライブラリ本体には依存しない（テストと SSR で安全に読み込めるようにする）。

import type { QuotePoint } from "@/lib/quote";

/** 1日分のローソク足（OHLC がすべて正の有限数）。 */
export interface OhlcBar {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 出来高（株）。取得できない日は null */
  volume: number | null;
}

/** 始値〜終値の最大/最小がこの倍率を超える足は Yahoo の穴埋め行とみなして捨てる。 */
const BROKEN_BAR_RATIO = 5;

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * /api/quote の closes をチャート用の日足に整える。
 * - 同じ日付が重複したら後ろの行を採用し、日付昇順に並べる（lightweight-charts は重複・逆順で例外になる）
 * - 始値・高値・安値・終値のどれかが欠けた日は描かない
 * - 出来高のある足が1本でもあれば、出来高 0 の行は捨てる（約定の無い日。Yahoo は上場前・上場日に
 *   open=close=553億円 のような穴埋め行を返すことがあり、残すと価格軸が壊れる）
 * - 1日の値幅が5倍を超える足（壊れた行）は捨てる
 */
export function toOhlcBars(points: readonly QuotePoint[]): OhlcBar[] {
  const byDate = new Map<string, OhlcBar>();
  for (const p of points) {
    if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
    const { open, high, low, close } = p;
    if (
      !isPositiveFinite(open) ||
      !isPositiveFinite(high) ||
      !isPositiveFinite(low) ||
      !isPositiveFinite(close)
    ) {
      continue;
    }
    const max = Math.max(open, high, low, close);
    const min = Math.min(open, high, low, close);
    if (max / min > BROKEN_BAR_RATIO) continue;
    const volume =
      typeof p.volume === "number" && Number.isFinite(p.volume) && p.volume >= 0
        ? p.volume
        : null;
    byDate.set(p.date, { date: p.date, open, high, low, close, volume });
  }

  const bars = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const hasTraded = bars.some((b) => b.volume !== null && b.volume > 0);
  return hasTraded ? bars.filter((b) => b.volume !== 0) : bars;
}

/** 期間切り替えの選択肢。 */
export type ChartPeriod = "1M" | "3M" | "6M" | "1Y";

export const CHART_PERIODS: readonly { value: ChartPeriod; label: string; months: number }[] = [
  { value: "1M", label: "1M", months: 1 },
  { value: "3M", label: "3M", months: 3 },
  { value: "6M", label: "6M", months: 6 },
  { value: "1Y", label: "1Y", months: 12 },
];

/** YYYY-MM-DD から months ヶ月前の日付（YYYY-MM-DD）。月末は繰り下げずに Date の繰り上がりに任せる。 */
export function subtractMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 - months, d));
  return date.toISOString().slice(0, 10);
}

/**
 * 期間の表示開始位置（bars のインデックス）。最終足の日付から months ヶ月前以降の最初の足。
 * データが期間より短ければ 0（全部見せる）。bars が空なら 0。
 */
export function periodStartIndex(bars: readonly OhlcBar[], months: number): number {
  if (bars.length === 0) return 0;
  const from = subtractMonths(bars[bars.length - 1].date, months);
  const idx = bars.findIndex((b) => b.date >= from);
  return idx < 0 ? 0 : idx;
}

/** 直近 days 暦日分の終値（スパークライン用）。points は日付昇順。 */
export function recentCloses(
  points: readonly { date: string; close: number }[],
  days: number,
): number[] {
  if (points.length === 0) return [];
  const last = points[points.length - 1].date;
  const [y, m, d] = last.split("-").map(Number);
  if (!y || !m || !d) return points.map((p) => p.close);
  const from = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from).map((p) => p.close);
}

/** 参照線を自動スケールに含める距離（表示中の値幅に対する倍率）。 */
const REFERENCE_REACH = 0.5;

/**
 * 参照線（公開価格・初値）を自動スケールに含めるかの判定。
 * 表示中の値幅（max-min）の半分以内に収まる線だけ含める。遠すぎる線まで含めると
 * ローソク足が潰れて読めなくなるため（その場合もチャート下の凡例に数値は出す）。
 */
export function extendRangeWithReferences(
  range: { minValue: number; maxValue: number },
  references: readonly number[],
): { minValue: number; maxValue: number } {
  const span = Math.max(range.maxValue - range.minValue, range.maxValue * 0.04) * REFERENCE_REACH;
  let { minValue, maxValue } = range;
  for (const r of references) {
    if (!Number.isFinite(r) || r <= 0) continue;
    if (r < range.minValue - span || r > range.maxValue + span) continue;
    minValue = Math.min(minValue, r);
    maxValue = Math.max(maxValue, r);
  }
  return { minValue, maxValue };
}

/** 価格の表示（1000円以上は整数・桁区切り、1000円未満は小数1桁まで）。 */
export function formatChartPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000
    ? Math.round(value).toLocaleString("ja-JP")
    : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

/** 出来高の表示（万株・億株に丸める）。null は「—」。 */
export function formatVolumeJa(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1e8) return `${(value / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}億`;
  if (value >= 1e4) return `${(value / 1e4).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万`;
  return Math.round(value).toLocaleString("ja-JP");
}

/**
 * CSS の色（#rgb / #rrggbb / rgb() / rgba()）に透明度を掛けた rgba() を返す。
 * 解釈できない色はそのまま返す。
 */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (ch) => ch + ch) : hex[1];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (rgb) {
    const base = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${Number((base * alpha).toFixed(3))})`;
  }
  return c;
}
