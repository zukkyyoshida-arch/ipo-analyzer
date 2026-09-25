import { computeMovingAverage } from "@/lib/chart/movingAverage";

export interface CandlePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 移動平均の日数。 */
const MA_WINDOW = 25;
/** 出来高バー領域の高さ（価格領域とは別枠で下に足す）。 */
const VOLUME_AREA = 60;

// 余白（viewBox 単位）。右は価格目盛り、下は日付ラベル用。
const PAD_LEFT = 4;
const PAD_RIGHT = 44;
const PAD_TOP = 18;
const PAD_BOTTOM = 18;

const TONE_COLOR = {
  accent: "var(--accent)",
  "accent-2": "var(--accent-2)",
} as const;

/** 価格目盛りの表示（整数円は桁区切り、1000円未満の小数は1桁）。 */
function formatPrice(value: number): string {
  return value >= 1000
    ? Math.round(value).toLocaleString("ja-JP")
    : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

/** YYYY-MM-DD → M/D。 */
function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 依存ライブラリなしの自前SVGローソク足チャート。25日移動平均線・出来高バーを併せて描画。
 * data.length < 2 なら何も描画しない（Sparkline と同じ規約）。
 * width は viewBox の基準幅。親幅が狭ければ max-width:100% で縮小する（横はみ出しなし）。
 * @param data 古い→新しい順の日足
 * @param volumes data と同じ並びの出来高（任意。指定時は下に出来高バーを +60 で描く）
 * @param referenceLines 公開価格・初値などの水平参照線（破線＋ラベル）
 * @param width 既定335
 * @param height 価格領域の高さ。既定220（出来高バー込みなら+60）
 */
export function Candlestick({
  data,
  volumes,
  referenceLines,
  width = 335,
  height = 220,
}: {
  data: CandlePoint[];
  volumes?: (number | null)[];
  referenceLines?: {
    label: string;
    value: number;
    tone: "accent" | "accent-2";
  }[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const refs = (referenceLines ?? []).filter(
    (r) => Number.isFinite(r.value) && r.value > 0,
  );
  const volumeValues = volumes
    ? data.map((_, i) => {
        const v = volumes[i];
        return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
      })
    : null;
  const hasVolume = volumeValues !== null && volumeValues.some((v) => v > 0);
  const totalHeight = height + (hasVolume ? VOLUME_AREA : 0);

  // 価格レンジ（参照線も必ず画面内に入るよう含める）。上下に5%の余白。
  const lows = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const rawMin = Math.min(...lows, ...refs.map((r) => r.value));
  const rawMax = Math.max(...highs, ...refs.map((r) => r.value));
  const margin = (rawMax - rawMin || rawMax || 1) * 0.05;
  const min = rawMin - margin;
  const max = rawMax + margin;
  const range = max - min || 1;

  const plotLeft = PAD_LEFT;
  const plotRight = width - PAD_RIGHT;
  const plotWidth = plotRight - plotLeft;
  const priceTop = PAD_TOP;
  const priceBottom = height - PAD_BOTTOM;
  const priceHeight = priceBottom - priceTop;

  const slot = plotWidth / data.length;
  const bodyWidth = Math.max(1, slot * 0.6);
  const xCenter = (i: number) => plotLeft + slot * (i + 0.5);
  const yPrice = (v: number) => priceTop + ((max - v) / range) * priceHeight;

  // 25日移動平均（25件未満の区間は描かない）。
  const ma = computeMovingAverage(
    data.map((d) => d.close),
    MA_WINDOW,
  );
  const maPoints = ma
    .map((v, i) =>
      v === null ? null : `${xCenter(i).toFixed(1)},${yPrice(v).toFixed(1)}`,
    )
    .filter((p): p is string => p !== null);

  // 出来高バー領域。
  const volumeTop = height + 6;
  const volumeHeight = VOLUME_AREA - 10;
  const maxVolume = hasVolume ? Math.max(...(volumeValues ?? [0])) : 0;

  const legendX = plotLeft + plotWidth / 2;

  // 価格目盛り（上・中・下の3本）。
  const ticks = [rawMax, (rawMax + rawMin) / 2, rawMin];

  const last = data[data.length - 1];
  const ariaLabel = `ローソク足チャート。${formatShortDate(data[0].date)}から${formatShortDate(last.date)}までの${data.length}日分、直近終値${formatPrice(last.close)}円${ma[ma.length - 1] !== null ? "、25日移動平均あり" : ""}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${totalHeight}`}
      width={width}
      height={totalHeight}
      role="img"
      aria-label={ariaLabel}
      className="block h-auto max-w-full"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {/* 価格目盛りのガイド線 */}
      {ticks.map((t, i) => (
        <g key={`tick-${i}`}>
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={yPrice(t)}
            y2={yPrice(t)}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text
            x={plotRight + 4}
            y={yPrice(t) + 3.5}
            fontSize={10}
            fill="var(--text-muted)"
          >
            {formatPrice(t)}
          </text>
        </g>
      ))}

      {/* 出来高バー */}
      {hasVolume &&
        volumeValues?.map((v, i) => {
          if (v <= 0 || maxVolume <= 0) return null;
          const h = (v / maxVolume) * volumeHeight;
          const up = data[i].close >= data[i].open;
          return (
            <rect
              key={`vol-${data[i].date}-${i}`}
              x={xCenter(i) - bodyWidth / 2}
              y={volumeTop + volumeHeight - h}
              width={bodyWidth}
              height={h}
              fill={up ? "var(--up)" : "var(--down)"}
              opacity={0.55}
            />
          );
        })}

      {/* ローソク足（ヒゲ＋実体） */}
      {data.map((d, i) => {
        const up = d.close >= d.open;
        const color = up ? "var(--up)" : "var(--down)";
        const top = yPrice(Math.max(d.open, d.close));
        const bottom = yPrice(Math.min(d.open, d.close));
        return (
          <g key={`candle-${d.date}-${i}`}>
            <line
              x1={xCenter(i)}
              x2={xCenter(i)}
              y1={yPrice(d.high)}
              y2={yPrice(d.low)}
              stroke={color}
              strokeWidth={1}
            />
            <rect
              x={xCenter(i) - bodyWidth / 2}
              y={top}
              width={bodyWidth}
              height={Math.max(1, bottom - top)}
              fill={color}
            />
          </g>
        );
      })}

      {/* 25日移動平均線 */}
      {maPoints.length >= 2 && (
        <polyline
          points={maPoints.join(" ")}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* 参照線（公開価格・初値など）: 破線＋ラベル */}
      {refs.map((r, i) => {
        const y = yPrice(r.value);
        const color = TONE_COLOR[r.tone];
        return (
          <g key={`ref-${r.label}-${i}`}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={y}
              y2={y}
              stroke={color}
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
            <text
              x={plotLeft + 2}
              y={y - 4}
              fontSize={10}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {`${r.label} ${formatPrice(r.value)}`}
            </text>
          </g>
        );
      })}

      {/* 凡例（25日移動平均）: 下端中央。参照線ラベルと重ならない位置に置く */}
      {maPoints.length >= 2 && (
        <g>
          <line
            x1={legendX - 40}
            x2={legendX - 26}
            y1={height - 7.5}
            y2={height - 7.5}
            stroke="var(--text-muted)"
            strokeWidth={1.5}
          />
          <text
            x={legendX - 22}
            y={height - 4}
            fontSize={10}
            fill="var(--text-muted)"
          >
            25日移動平均
          </text>
        </g>
      )}

      {/* 期間の始点・終点の日付 */}
      <text x={plotLeft} y={height - 4} fontSize={10} fill="var(--text-muted)">
        {formatShortDate(data[0].date)}
      </text>
      <text
        x={plotRight}
        y={height - 4}
        fontSize={10}
        fill="var(--text-muted)"
        textAnchor="end"
      >
        {formatShortDate(last.date)}
      </text>
    </svg>
  );
}
