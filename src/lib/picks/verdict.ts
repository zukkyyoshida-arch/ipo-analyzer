// 銘柄の「結論バッジ」（参加候補／様子見／見送り）を決める純関数。
// BB参加スコア・公募割れ確率・チェックポイント ✗ の数だけを材料にした機械的な目安で、売買推奨ではない。

export type Verdict = "join" | "watch" | "skip";

export const VERDICT_LABELS: Record<Verdict, string> = {
  join: "参加候補",
  watch: "様子見",
  skip: "見送り",
};

/** 参加候補になる BB参加スコアの下限 */
export const JOIN_MIN_BB_SCORE = 50;
/** 参加候補になる公募割れ確率（%）の上限（これ未満） */
export const JOIN_MAX_BREAK_EVEN_PCT = 30;
/** 参加候補になる ✗ の上限（これ以下） */
export const JOIN_MAX_NG = 2;
/** 見送りになる公募割れ確率（%）の下限（これ以上） */
export const SKIP_MIN_BREAK_EVEN_PCT = 45;
/** 見送りになる ✗ の下限（これ以上） */
export const SKIP_MIN_NG = 4;

/**
 * 結論を決める。
 * - 見送り: 公募割れ 45% 以上、または ✗ 4 以上
 * - 参加候補: BB 50 以上 かつ 公募割れ 30% 未満 かつ ✗ 2 以下（BB・公募割れが null なら満たさない扱い）
 * - それ以外: 様子見
 * @param bbScore BB参加スコア（0〜100）。算出できないときは null
 * @param breakEvenPct 公募割れ確率（0〜100 の %）。算出できないときは null
 * @param ngCount チェックポイントの ✗（警戒）の数
 */
export function verdictFor({
  bbScore,
  breakEvenPct,
  ngCount,
}: {
  bbScore: number | null;
  breakEvenPct: number | null;
  ngCount: number;
}): Verdict {
  if ((breakEvenPct !== null && breakEvenPct >= SKIP_MIN_BREAK_EVEN_PCT) || ngCount >= SKIP_MIN_NG) {
    return "skip";
  }
  if (
    bbScore !== null &&
    bbScore >= JOIN_MIN_BB_SCORE &&
    breakEvenPct !== null &&
    breakEvenPct < JOIN_MAX_BREAK_EVEN_PCT &&
    ngCount <= JOIN_MAX_NG
  ) {
    return "join";
  }
  return "watch";
}
