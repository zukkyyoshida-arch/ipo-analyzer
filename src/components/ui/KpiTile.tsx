export type KpiTone = "neutral" | "accent" | "up" | "down" | "warn";

const TONE_TEXT: Record<KpiTone, string> = {
  neutral: "text-text",
  accent: "text-accent",
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
};

/**
 * KPI表示用の小型タイル。ホーム画面のKPI4枚等で使う。
 * @param label タイルの見出し（例: "対象銘柄数"）
 * @param value 主要な数値・文言
 * @param sub 補足文言（任意。単位や期間など）
 * @param tone valueの色調（既定 neutral）
 */
export function KpiTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-medium ${TONE_TEXT[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}
