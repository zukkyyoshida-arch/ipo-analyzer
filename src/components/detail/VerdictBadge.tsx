import {
  PICK_VERDICT_LABELS,
  pickVerdictSummary,
  type PickVerdict,
  type PickVerdictInput,
} from "@/lib/picks/verdict";

const VERDICT_CLASS: Record<PickVerdict, string> = {
  go: "text-ok bg-ok/15",
  watch: "text-warn bg-warn/15",
  skip: "text-ng bg-ng/15",
};

/**
 * 銘柄詳細の結論バッジ（参加候補／様子見／見送り）＋根拠1行。
 * @param verdict pickVerdict の結果
 * @param phaseLabel 今のフェーズ名（BB前・BB中など）
 * @param input 判定の材料（根拠1行は pickVerdictSummary で作る。ピックアップのカードと同じ文言）
 */
export function VerdictBadge({
  verdict,
  phaseLabel,
  input,
}: {
  verdict: PickVerdict;
  phaseLabel: string;
  input: PickVerdictInput;
}) {
  const reasons = pickVerdictSummary(input);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-surface px-4 py-3">
      <span
        className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-base font-medium ${VERDICT_CLASS[verdict]}`}
        aria-label={`結論: ${PICK_VERDICT_LABELS[verdict]}`}
      >
        {PICK_VERDICT_LABELS[verdict]}
      </span>
      <span className="min-w-0 flex-1 text-xs tabular-nums text-muted">{reasons}</span>
      <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
        {phaseLabel}
      </span>
    </div>
  );
}
