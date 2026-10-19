// ピックアップのカードに出す「結論」の判定。純関数。
// 材料は BB スコア・公募割れ確率・チェックポイントの ✗（警戒）の数。しきい値は下の定数にまとめる
// （設定画面との連動はまだしない）。

export type PickVerdict = "go" | "watch" | "skip";

export const PICK_VERDICT_LABELS: Record<PickVerdict, string> = {
  go: "参加候補",
  watch: "様子見",
  skip: "見送り",
};

/** 判定のしきい値。公募割れ確率は 0〜1。 */
export const PICK_VERDICT_THRESHOLDS = {
  /** 参加候補: BB スコアがこれ以上 */
  goMinBbScore: 50,
  /** 参加候補: 公募割れ確率がこれ未満 */
  goMaxBreakEven: 0.3,
  /** 参加候補: ✗ がこれ以下 */
  goMaxFail: 2,
  /** 見送り: 公募割れ確率がこれ以上 */
  skipMinBreakEven: 0.45,
  /** 見送り: ✗ がこれ以上 */
  skipMinFail: 4,
} as const;

export interface PickVerdictInput {
  bbScore: number;
  /** 公募割れ確率（0〜1）。分からなければ null */
  breakEvenProbability: number | null;
  /** チェックポイントの ✗ の数。チェックを出していなければ null（0 とみなす） */
  failCount: number | null;
}

/**
 * 結論を1つに決める。
 * - 見送り: 公募割れ確率が 45% 以上、または ✗ が 4 以上
 * - 参加候補: BB スコア 50 以上・公募割れ確率 30% 未満・✗ 2 以下（公募割れ確率が分からなければ参加候補にしない）
 * - それ以外: 様子見
 */
export function pickVerdict(
  { bbScore, breakEvenProbability: p, failCount }: PickVerdictInput,
  t = PICK_VERDICT_THRESHOLDS,
): PickVerdict {
  const fail = failCount ?? 0;
  if ((p !== null && p >= t.skipMinBreakEven) || fail >= t.skipMinFail) return "skip";
  if (bbScore >= t.goMinBbScore && p !== null && p < t.goMaxBreakEven && fail <= t.goMaxFail) return "go";
  return "watch";
}

/**
 * 根拠の1行「BB 48 ・ 公募割れ 41% ・ ✗3」。公募割れが分からなければ「公募割れ —」、
 * チェックを出していなければ ✗ の項は省く。
 */
export function pickVerdictSummary({ bbScore, breakEvenProbability: p, failCount }: PickVerdictInput): string {
  const parts = [`BB ${Math.round(bbScore)}`, `公募割れ ${p === null ? "—" : `${Math.round(p * 100)}%`}`];
  if (failCount !== null) parts.push(`✗${failCount}`);
  return parts.join(" ・ ");
}
