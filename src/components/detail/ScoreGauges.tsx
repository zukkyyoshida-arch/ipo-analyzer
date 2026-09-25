import { ScoreGauge } from "@/components/ui/ScoreGauge";
import type { IpoScoreResult } from "@/lib/scoring/types";
import { overallScore } from "@/lib/scoring";

/**
 * 需給・ファンダ・総合の3スコアゲージを横並びで表示する。375pxで収まるsmサイズ。
 */
export function ScoreGauges({ score }: { score: IpoScoreResult }) {
  return (
    <div className="flex items-center justify-around gap-2">
      <ScoreGauge
        score={score.supplyDemand.score}
        label="需給"
        size="sm"
      />
      <ScoreGauge
        score={score.fundamental.score}
        label="ファンダ"
        size="sm"
      />
      <ScoreGauge score={overallScore(score)} label="総合" size="sm" />
    </div>
  );
}
