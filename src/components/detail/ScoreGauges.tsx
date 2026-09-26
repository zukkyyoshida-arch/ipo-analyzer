import { ScoreGauge } from "@/components/ui/ScoreGauge";
import type { IpoScoreResult } from "@/lib/scoring/types";
import { overallScore } from "@/lib/scoring";

/**
 * 需給・ファンダ・（BB参加）・総合のスコアゲージを横並びで表示する。375pxで収まるsmサイズ。
 * bbScore を渡したときだけ4本目「BB参加」を出す。
 */
export function ScoreGauges({
  score,
  bbScore,
}: {
  score: IpoScoreResult;
  bbScore?: number;
}) {
  const hasBb = typeof bbScore === "number";
  return (
    <div
      className={
        hasBb
          ? "grid grid-cols-4 justify-items-center gap-1"
          : "flex items-center justify-around gap-2"
      }
    >
      <ScoreGauge score={score.supplyDemand.score} label="需給" size="sm" />
      <ScoreGauge score={score.fundamental.score} label="ファンダ" size="sm" />
      {hasBb ? <ScoreGauge score={bbScore} label="BB参加" size="sm" /> : null}
      <ScoreGauge score={overallScore(score)} label="総合" size="sm" />
    </div>
  );
}
