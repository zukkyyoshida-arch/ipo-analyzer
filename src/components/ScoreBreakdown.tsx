import type { AxisScoreResult } from "@/lib/scoring/types";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

// スコア内訳: 項目カードの縦積み。
// 上段: ラベル＋根拠(reason)。下段: 生データ(rawText)・点数(points)・重み(weight)・寄与(contribution)のチップ行。
export function ScoreBreakdown({
  title,
  axis,
}: {
  title: string;
  axis: AxisScoreResult;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-text">{title}</h3>
      <div className="space-y-2">
        {axis.items.map((item) => (
          <Card key={item.key} className="p-3">
            <p className="text-sm font-medium text-text">{item.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {item.reason}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <Chip tone="neutral">{item.rawText}</Chip>
              <PointChip points={item.points} />
              <Chip tone="neutral">重み {item.weight}</Chip>
              <ContributionChip contribution={item.contribution} />
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-muted">
        寄与合計 {axis.rawTotal}（{axis.minTotal}〜{axis.maxTotal}）
      </p>
    </div>
  );
}

function PointChip({ points }: { points: number }) {
  const tone = points > 0 ? "up" : points < 0 ? "down" : "neutral";
  return (
    <Chip tone={tone}>
      点数 {points > 0 ? "+" : ""}
      {points}
    </Chip>
  );
}

function ContributionChip({ contribution }: { contribution: number }) {
  const tone = contribution > 0 ? "up" : contribution < 0 ? "down" : "neutral";
  return (
    <Chip tone={tone}>
      寄与 {contribution > 0 ? "+" : ""}
      {contribution}
    </Chip>
  );
}
