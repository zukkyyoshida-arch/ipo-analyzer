/**
 * 数値配列をインライン折れ線SVGとして描画する軽量スパークライン。
 * 依存ライブラリなし。data.length < 2 の場合は何も描画しない。
 * @param data 古い→新しい順の数値配列
 * @param width SVG幅（既定 120）
 * @param height SVG高さ（既定 32）
 * @param tone "up"|"down"|"neutral"。既定は最初と最後の値の比較から自動判定
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  tone,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: "up" | "down" | "neutral";
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const resolvedTone =
    tone ?? (data[data.length - 1] >= data[0] ? "up" : "down");
  const stroke =
    resolvedTone === "up"
      ? "var(--up)"
      : resolvedTone === "down"
        ? "var(--down)"
        : "var(--chart-line)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
