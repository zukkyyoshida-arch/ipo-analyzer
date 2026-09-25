import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { UnderwriterAllocation } from "@/types/enriched";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { Chip } from "@/components/ui/Chip";
import { LOTTERY_TYPE_LABELS, rankBrokersForIpo } from "@/lib/bb/priority";

/**
 * 幹事団と申込優先順位。幹事配分×抽選方式から算出した参考順位（/bb 画面と同じロジック）。
 * 対象証券会社が1社も無いときは主幹事名だけを1行で示す。
 */
export function UnderwriterPriority({
  ipo,
  brokers,
  allocations,
}: {
  ipo: Ipo;
  brokers: Broker[];
  allocations: UnderwriterAllocation[] | undefined;
}) {
  const entries = rankBrokersForIpo(ipo, brokers, allocations);
  const hasAllocations = (allocations?.length ?? 0) > 0;
  const lead = ipo.leadUnderwriter.trim() || "未取得";

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted">
        幹事団の配分情報は未取得です。主幹事: {lead}
      </p>
    );
  }

  return (
    <Card className="px-4 py-1">
      {!hasAllocations ? (
        <p className="border-b border-border py-2 text-[11px] leading-relaxed text-muted">
          配分比率は未取得のため、主幹事／幹事の区分と抽選方式から算出しています。主幹事: {lead}
        </p>
      ) : null}
      {entries.map((e, i) => (
        <ListRow
          key={e.broker.id}
          className="min-h-11"
          label={`${i + 1}. ${e.broker.name}`}
          value={
            <span className="flex flex-wrap items-center justify-end gap-1">
              {e.isLead ? <Chip tone="accent">主幹事</Chip> : null}
              <span className="text-xs text-muted tabular-nums">
                {e.allocationRatioPercent === null
                  ? "配分 —"
                  : `配分 ${e.allocationRatioPercent.toFixed(1)}%`}
                ・{LOTTERY_TYPE_LABELS[e.broker.lotteryType]}
              </span>
              <span className="tabular-nums">{Math.round(e.priorityScore)}</span>
            </span>
          }
        />
      ))}
    </Card>
  );
}
