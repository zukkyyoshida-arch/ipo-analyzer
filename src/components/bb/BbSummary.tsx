import type { BbStatus } from "@/types/broker";
import { KpiTile } from "@/components/ui/KpiTile";
import { Card } from "@/components/ui/Card";

/**
 * BB画面上部の集計表示。ステータス別件数（2×2）＋資金拘束目安の合計。
 * @param counts ステータス別件数
 * @param lockAmount 資金拘束目安の合計（円）
 */
export function BbSummary({
  counts,
  lockAmount,
}: {
  counts: Record<BbStatus, number>;
  lockAmount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="申込済" value={`${counts.applied}件`} />
        <KpiTile label="当選" value={`${counts.won}件`} tone="up" />
        <KpiTile label="補欠" value={`${counts.waitlist}件`} tone="warn" />
        <KpiTile label="落選" value={`${counts.lost}件`} />
      </div>
      <Card className="p-4">
        <p className="text-[11px] text-muted">資金拘束目安（合計）</p>
        <p className="mt-1 text-2xl font-bold text-text">
          {lockAmount.toLocaleString()}
          <span className="ml-1 text-sm font-normal text-muted">円</span>
        </p>
        <p className="mt-1 text-[11px] text-muted">
          申込済・当選のステータスを対象に集計。
        </p>
      </Card>
    </div>
  );
}
