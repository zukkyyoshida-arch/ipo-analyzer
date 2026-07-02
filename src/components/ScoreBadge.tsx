// スコアの可視化コンポーネント（バッジ + 横棒）。
// 中立表現のみ（「買い」等の語は使わない）。

function scoreColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-lime-500";
  if (score >= 30) return "bg-amber-500";
  return "bg-rose-500";
}

function scoreTextColor(score: number): string {
  if (score >= 70) return "text-emerald-700";
  if (score >= 50) return "text-lime-700";
  if (score >= 30) return "text-amber-700";
  return "text-rose-700";
}

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
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`text-sm font-bold ${scoreTextColor(score)}`}>
          {score}
          <span className="text-xs font-normal text-slate-400">/100</span>
        </span>
      </div>
      <ScoreBar score={score} />
    </div>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const width = Math.max(0, Math.min(100, score));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${scoreColor(score)}`}
        style={{ width: `${width}%` }}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// コンパクトなスコアピル（一覧カード用）。
export function ScorePill({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${scoreTextColor(
        score,
      )} bg-slate-50 ring-1 ring-slate-200`}
    >
      <span className="text-[10px] font-normal text-slate-500">{label}</span>
      {score}
    </span>
  );
}
