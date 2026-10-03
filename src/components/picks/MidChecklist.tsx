import type { CheckpointVerdict } from "@/lib/checkpoints/types";
import type { MidCheckResult, MidManualVerdict } from "@/lib/picks/midSecondary";

// 中長期セカンダリの「10 のチェックポイント」を講師の番号順に並べる一覧（ホームの行の展開と銘柄詳細で共用）。
// ①業種業態には目視の ◎○× トグルを付ける（押すと端末に保存。同じボタンをもう一度押すと外す）。

const NUMBER_GLYPH = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

const VERDICT_ICON: Record<CheckpointVerdict, string> = { pass: "✓", warn: "△", fail: "✗", unknown: "・" };
const VERDICT_CLASS: Record<CheckpointVerdict, string> = {
  pass: "text-up bg-up/15",
  warn: "text-warn bg-warn/15",
  fail: "text-down bg-down/15",
  unknown: "text-muted bg-surface-2",
};
const VERDICT_LABEL: Record<CheckpointVerdict, string> = { pass: "クリア", warn: "注意", fail: "警戒", unknown: "不明" };

const MANUAL_OPTIONS: { value: MidManualVerdict; label: string; aria: string }[] = [
  { value: "strong", label: "◎", aria: "目視 ◎（オンリーワン・ニッチトップ）" },
  { value: "ok", label: "○", aria: "目視 ○（まずまず）" },
  { value: "ng", label: "×", aria: "目視 ×（当てはまらない）" },
];

/** ①業種業態の目視トグル（44px 以上の押しやすさ・押した状態は塗りと aria-pressed）。 */
export function MidManualToggle({
  code,
  value,
  onChange,
}: {
  code: string;
  value?: MidManualVerdict;
  onChange?: (code: string, verdict: MidManualVerdict | null) => void;
}) {
  return (
    <span className="mt-1.5 inline-flex gap-1.5" role="group" aria-label="業種業態の目視">
      {MANUAL_OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={o.aria}
            disabled={!onChange}
            onClick={() => onChange?.(code, on ? null : o.value)}
            className={`min-h-11 min-w-11 rounded-lg border text-base font-medium transition-colors ${
              on ? "border-accent bg-accent text-on-accent" : "border-border bg-surface-2 text-text active:opacity-80"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

/**
 * @param code 銘柄コード（目視の保存キー）
 * @param checks runMidChecks の結果
 * @param manual いまの目視
 * @param onManual 目視を変える（無ければトグルは押せない）
 */
export function MidChecklist({
  code,
  checks,
  manual,
  onManual,
}: {
  code: string;
  checks: readonly MidCheckResult[];
  manual?: MidManualVerdict;
  onManual?: (code: string, verdict: MidManualVerdict | null) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {checks.map((c) => {
        const verdictLabel = c.displayOnly ? "表示だけ" : VERDICT_LABEL[c.verdict];
        return (
          <li key={c.id} className="flex items-start gap-2 py-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                c.displayOnly ? "border border-subtle text-muted" : VERDICT_CLASS[c.verdict]
              }`}
              title={verdictLabel}
              aria-label={verdictLabel}
            >
              {c.displayOnly ? "・" : VERDICT_ICON[c.verdict]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-text">
                  {c.no ? <span className="mr-1 text-muted">{NUMBER_GLYPH[c.no]}</span> : null}
                  {c.label}
                </span>
                <span className="min-w-0 break-words text-right text-sm tabular-nums text-text">{c.value}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">
                基準: {c.threshold}
                {c.source ? `（出典: ${c.source}）` : null}
              </p>
              {c.id === "industry" ? <MidManualToggle code={code} value={manual} onChange={onManual} /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
