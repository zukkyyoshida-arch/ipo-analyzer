import type { Ipo } from "@/types/ipo";
import {
  outcomeReferenceDate,
  underwriterBreakEvenStat,
  type OutcomeSource,
  type UnderwriterBreakEvenStat,
} from "@/lib/stats";
import { ipoToOutcomeSource } from "@/lib/stats/history";
import { buildBbContext, type BbScoreContext } from "./bb";
import { estimateBreakEvenProbability, type BreakEvenProbability } from "./bbProbability";

// 銘柄1件の BB 参加スコア・公募割れ確率に使う材料をサーバー側で作る純関数。
// 銘柄詳細（/ipo/[code]）とホームのピックアップ（BB）が同じ値を出すよう、どちらもここを通す。

export interface BbInputs {
  /** 主幹事の公募割れ実績（直近3年・自身を除く）。実績なしは null。 */
  underwriterStat: UnderwriterBreakEvenStat | null;
  /** 直近 IPO の初値動向・同週上場件数。 */
  bbContext: BbScoreContext;
  /** 公募割れ確率（実績ベース）。未取得項目が多い銘柄は null。 */
  breakEvenProbability: BreakEvenProbability | null;
}

/**
 * @param ipo 対象銘柄
 * @param allIpos 現行データの全銘柄（直近 IPO の初値動向・同週上場件数の母数）
 * @param sources 現行データ＋履歴（combineOutcomeSources の結果。主幹事の実績の母数）
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function buildBbInputs(
  ipo: Ipo,
  allIpos: Ipo[],
  sources: readonly OutcomeSource[],
  todayIso: string,
): BbInputs {
  // 主幹事の実績は直近3年固定（レジーム差を避ける）。自身を除く（結果リーク回避）。
  const underwriterStat = underwriterBreakEvenStat(
    sources.filter((s) => s.code !== ipo.code),
    ipo.leadUnderwriter,
    { period: "recent3y", referenceDate: outcomeReferenceDate(ipoToOutcomeSource(ipo), todayIso) },
  );
  const bbContext = buildBbContext(ipo, allIpos);
  const breakEvenProbability = estimateBreakEvenProbability(ipo, { ...bbContext, underwriterStat });
  return { underwriterStat, bbContext, breakEvenProbability };
}
