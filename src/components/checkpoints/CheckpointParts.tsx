import { Chip } from "@/components/ui/Chip";
import type { CheckpointChip } from "@/lib/checkpoints/common";
import type { CheckpointCounts } from "@/lib/checkpoints/types";
import { INSTANT_CASH_LABEL, type InstantCashStatus } from "@/lib/checkpoints/instantCash";

// チェックポイントの小さな部品（ピックアップの行・銘柄詳細で共用）。

/** 「✓5 △2 ✗1」の小さな集計。0 件の判定は出さない（判定不能も出さない）。 */
export function CheckCountsInline({ counts, className = "" }: { counts: CheckpointCounts; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] tabular-nums ${className}`}
      aria-label={`チェック クリア${counts.pass}・注意${counts.warn}・警戒${counts.fail}`}
    >
      <span className="text-ok">✓{counts.pass}</span>
      {counts.warn > 0 ? <span className="text-warn">△{counts.warn}</span> : null}
      {counts.fail > 0 ? <span className="text-ng">✗{counts.fail}</span> : null}
    </span>
  );
}

/** 即金規制のマーク。規制が無さそうなら何も出さない。 */
export function InstantCashChip({ status }: { status: InstantCashStatus | undefined }) {
  if (!status) return null;
  return <Chip tone="warn">{INSTANT_CASH_LABEL[status]}</Chip>;
}

/** 共通チェックの理由チップ。 */
export function CheckpointChips({ chips }: { chips: CheckpointChip[] }) {
  return (
    <>
      {chips.map((c) => (
        <Chip key={c.id} tone={c.tone === "good" ? "up" : "down"}>
          {c.text}
        </Chip>
      ))}
    </>
  );
}
