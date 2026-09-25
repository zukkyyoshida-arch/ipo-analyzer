import type { BreakEvenProbability } from "@/lib/scoring/bbProbability";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";

/** YYYY-MM-DD の年だけを取り出す。 */
function yearOf(iso: string): string {
  return iso.slice(0, 4);
}

/**
 * 公募割れ確率（実績ベース）。estimateBreakEvenProbability の結果を表示するだけの薄いカード。
 * 学習期間・母数・検証AUC を必ず添え、参考情報であることを明示する。
 * result が null（未取得項目が多い）なら数値は出さない。
 */
export function BbProbabilityCard({
  result,
}: {
  result: BreakEvenProbability | null;
}) {
  if (result === null) {
    return (
      <EmptyState
        title="公募割れ確率（実績ベース）は算出していません"
        description="吸収金額などの未取得項目が多いため。データがそろうと表示します。"
      />
    );
  }
  const percent = Math.round(result.probability * 100);
  const tone = percent >= 30 ? "text-down" : percent < 10 ? "text-up" : "text-text";
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">公募割れ確率（実績ベース）</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>
        {percent}
        <span className="ml-0.5 text-base">%</span>
      </p>
      <p className="mt-2 text-xs text-muted tabular-nums">
        学習 {yearOf(result.trainedFrom)}〜{yearOf(result.trainedThrough)}年 {result.sampleCount.toLocaleString()}件・検証AUC{" "}
        {result.auc.toFixed(2)}（学習に使っていない{result.validationCount}件）
      </p>
      {result.missingCount > 0 ? (
        <div className="mt-2">
          <Chip tone="warn">未取得 {result.missingCount}項目は中立として計算</Chip>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">
        BB参加スコアの各項目から、過去の上場銘柄で初値が公開価格を下回った割合を機械的に当てはめた参考情報。将来を保証しません。
      </p>
    </Card>
  );
}
