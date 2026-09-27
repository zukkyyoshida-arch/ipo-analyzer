// スコアの可視化コンポーネント（バッジ + 横棒）。
// 中立表現のみ（投資判断を示唆する語は使わない）。

function scoreBarClass(score: number): string {
  if (score >= 70) return "bg-up";
  if (score >= 50) return "bg-accent";
  if (score >= 30) return "bg-warn";
  return "bg-down";
}

function scoreTextClass(score: number): string {
  if (score >= 70) return "text-up";
  if (score >= 50) return "text-accent";
  if (score >= 30) return "text-warn";
  return "text-down";
}

/**
 * スコアのバッジ表示（ラベル＋数値＋横棒）。
 * @param score 0〜100のスコア
 * @param label 見出し文言（例: "需給"）
 */
export function ScoreBadge({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={`text-sm font-medium ${scoreTextClass(score)}`}>
          {score}
          <span className="text-xs font-normal text-muted">/100</span>
        </span>
      </div>
      <ScoreBar score={score} />
    </div>
  );
}

/**
 * スコアの横棒表示のみ。
 * @param score 0〜100のスコア
 */
export function ScoreBar({ score }: { score: number }) {
  const width = Math.max(0, Math.min(100, score));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full ${scoreBarClass(score)}`}
        style={{ width: `${width}%` }}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

/**
 * コンパクトなスコアピル（一覧カード用）。
 * @param score 0〜100のスコア
 * @param label 見出し文言（例: "需給"）
 */
export function ScorePill({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium ${scoreTextClass(
        score,
      )}`}
    >
      <span className="text-[10px] font-normal text-muted">{label}</span>
      {score}
    </span>
  );
}
