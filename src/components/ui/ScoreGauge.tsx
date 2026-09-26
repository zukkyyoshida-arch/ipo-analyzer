export type ScoreGaugeSize = "sm" | "md" | "lg";

const SIZE_PX: Record<ScoreGaugeSize, number> = {
  sm: 56,
  md: 88,
  lg: 120,
};

function scoreColorVar(score: number): string {
  if (score >= 70) return "var(--up)";
  if (score >= 40) return "var(--accent)";
  return "var(--down)";
}

/**
 * 0〜100のスコアを円弧SVGで表示するゲージ。
 * @param score 0〜100のスコア
 * @param label ゲージ下に表示するラベル（任意）
 * @param size "sm"|"md"|"lg"（既定 "md"）
 */
export function ScoreGauge({
  score,
  label,
  size = "md",
}: {
  score: number;
  label?: string;
  size?: ScoreGaugeSize;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const px = SIZE_PX[size];
  const stroke = size === "sm" ? 6 : size === "md" ? 9 : 11;
  const r = px / 2 - stroke;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const color = scoreColorVar(clamped);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: px, height: px }}>
        <svg
          viewBox={`0 0 ${px} ${px}`}
          width={px}
          height={px}
          className="-rotate-90"
        >
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center font-bold text-text"
          style={{ fontSize: size === "sm" ? 14 : size === "md" ? 20 : 26 }}
        >
          {Math.round(clamped)}
        </div>
      </div>
      {label ? <span className="text-xs text-muted">{label}</span> : null}
    </div>
  );
}
