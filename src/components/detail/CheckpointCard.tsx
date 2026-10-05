import type { Ipo } from "@/types/ipo";
import type { CheckpointEnriched, CheckpointVerdict } from "@/lib/checkpoints/types";
import type { CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import { runCommonCheckpoints } from "@/lib/checkpoints/common";
import Link from "next/link";

// 銘柄詳細の「チェックポイント」カード。BB・短期セカンダリで共通の 9 項目を、値と基準つきで並べる。

const VERDICT_ICON: Record<CheckpointVerdict, string> = { pass: "✓", warn: "△", fail: "✗", unknown: "・" };
const VERDICT_CLASS: Record<CheckpointVerdict, string> = {
  pass: "text-ok bg-ok/15",
  warn: "text-warn bg-warn/15",
  fail: "text-ng bg-ng/15",
  unknown: "text-muted bg-surface-2",
};
const VERDICT_LABEL: Record<CheckpointVerdict, string> = { pass: "クリア", warn: "注意", fail: "警戒", unknown: "参考" };

/**
 * @param ipo 対象銘柄
 * @param enriched 補完データ（業績・大株主・SO・発行済株数・VC 株数）
 * @param thresholds 設定のしきい値
 */
export function CheckpointCard({
  ipo,
  enriched,
  thresholds,
}: {
  ipo: Ipo;
  enriched?: CheckpointEnriched;
  thresholds: CheckpointThresholds;
}) {
  const { items, counts } = runCommonCheckpoints({ ipo, enriched }, thresholds);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">チェックポイント</h2>
        <div className="flex items-center gap-2 text-xs">
          {(["pass", "warn", "fail"] as const).map((v) => (
            <span key={v} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${VERDICT_CLASS[v]}`}>
              {VERDICT_ICON[v]}
              {counts[v]}
            </span>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 py-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${VERDICT_CLASS[item.verdict]}`}
              title={VERDICT_LABEL[item.verdict]}
              aria-label={VERDICT_LABEL[item.verdict]}
            >
              {VERDICT_ICON[item.verdict]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-text">{item.label}</span>
                <span className="text-sm tabular-nums text-text">{item.value}</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.reason}</p>
              <p className="text-[11px] text-subtle">基準: {item.threshold}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted" aria-label="判定の見方">
        <span className="text-ok">✓ クリア</span>
        <span className="mx-1.5">／</span>
        <span className="text-warn">△ 注意</span>
        <span className="mx-1.5">／</span>
        <span className="text-ng">✗ 警戒</span>
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        基準は
        <Link href="/settings#thresholds" className="mx-0.5 text-accent underline-offset-2 hover:underline">
          設定の「手法のしきい値」
        </Link>
        で変えられます。目論見書の公開情報を機械的に照合した参考情報です。
      </p>
    </section>
  );
}
