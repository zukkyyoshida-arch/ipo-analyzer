import type { BbScoreResult } from "@/lib/scoring/bb";
import type { AxisScoreResult, ScoreItemResult } from "@/lib/scoring/types";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";

/**
 * BB参加スコアの内訳。BbScoreResult を既存 ScoreBreakdown 互換の形に変換して表示する薄いアダプタ。
 * key は React の key にしか使われないため型だけ合わせる。
 */
export function toAxisScoreResult(bb: BbScoreResult): AxisScoreResult {
  const items: ScoreItemResult[] = bb.items.map((item) => ({
    key: item.key as unknown as ScoreItemResult["key"],
    label: item.label,
    rawText: item.rawText,
    points: item.points,
    weight: item.weight,
    contribution: item.contribution,
    reason: item.reason,
  }));
  const weightSum = bb.items.reduce((sum, i) => sum + i.weight, 0);
  return {
    score: bb.score,
    items,
    rawTotal: bb.items.reduce((sum, i) => sum + i.contribution, 0),
    maxTotal: weightSum * 2,
    minTotal: weightSum * -2,
  };
}

export function BbScoreBreakdown({ bbScore }: { bbScore: BbScoreResult }) {
  return <ScoreBreakdown title="BB参加スコア" axis={toAxisScoreResult(bbScore)} />;
}
