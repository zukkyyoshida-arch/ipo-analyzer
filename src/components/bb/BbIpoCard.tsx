import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import type { BbEntry } from "@/types/userData";
import type { BrokerPriorityEntry } from "@/lib/bb/priority";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ListRow } from "@/components/ui/ListRow";
import { ScorePill } from "@/components/ScoreBadge";
import { BbStatusSelect } from "@/components/BbStatusSelect";
import { BrokerPriorityList } from "@/components/bb/BrokerPriorityList";
import { STATUS_LABELS, formatDate, formatYen } from "@/lib/format";

/** 日付範囲を「開始〜終了」形式で表示。両方空なら「未取得」。 */
function formatDateRange(range: { start: string; end: string }): string {
  if (!range.start && !range.end) return "未取得";
  if (range.start && range.end) {
    return `${formatDate(range.start)}〜${formatDate(range.end)}`;
  }
  return formatDate(range.start || range.end);
}

/** BB期間・抽選日・購入期間・公開価格の4項目すべてが未取得か判定する。 */
function hasNoBbScheduleData(ipo: Ipo): boolean {
  return (
    !ipo.bbPeriod.start &&
    !ipo.bbPeriod.end &&
    !ipo.allotmentDate &&
    !ipo.purchasePeriod.start &&
    !ipo.purchasePeriod.end &&
    ipo.offeringPrice === null
  );
}

/**
 * BB画面の銘柄カード。銘柄名・コード・BB参加スコア・BB期間・抽選日・購入期間・公開価格を上段に、
 * 証券会社ごとのBB申込ステータス行を優先順位順（幹事団外は末尾）で下段に表示する。
 * @param ipo 対象銘柄
 * @param brokers 証券会社一覧
 * @param priorities rankBrokersForIpo の結果（幹事団内の優先順位）
 * @param bbScore BB参加スコア（データ不足で非表示にする場合は null）
 * @param getEntry 銘柄コード×証券会社IDのBB申込レコード取得
 * @param setStatus BB申込ステータスの更新
 */
export function BbIpoCard({
  ipo,
  brokers,
  priorities,
  bbScore,
  getEntry,
  setStatus,
}: {
  ipo: Ipo;
  brokers: Broker[];
  priorities: BrokerPriorityEntry[];
  bbScore: number | null;
  getEntry: (code: string, brokerId: string) => BbEntry;
  setStatus: (code: string, brokerId: string, status: BbStatus) => void;
}) {
  const syndicateKnown = priorities.length > 0;
  const hasAllocation = priorities.some((p) => p.allocationRatioPercent !== null);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/ipo/${ipo.code}`}
            // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
            prefetch={false}
            className="flex min-h-11 items-center"
          >
            <span className="truncate font-medium text-text hover:underline">
              {ipo.name}
            </span>
          </Link>
          <p className="-mt-1 text-xs text-muted">
            {ipo.code}・{ipo.market}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip tone="neutral">{STATUS_LABELS[ipo.status]}</Chip>
          {bbScore !== null && <ScorePill label="BB参加" score={bbScore} />}
        </div>
      </div>

      <div className="mt-3">
        {hasNoBbScheduleData(ipo) ? (
          <ListRow label="BB日程・公開価格" value="未取得" />
        ) : (
          <>
            <ListRow label="BB期間" value={formatDateRange(ipo.bbPeriod)} />
            <ListRow
              label="抽選日"
              value={ipo.allotmentDate ? formatDate(ipo.allotmentDate) : "未取得"}
            />
            <ListRow
              label="購入期間"
              value={formatDateRange(ipo.purchasePeriod)}
            />
            <ListRow label="公開価格" value={formatYen(ipo.offeringPrice)} />
          </>
        )}
      </div>

      <div className="mt-3">
        <p className="mb-2 text-[11px] text-muted">
          {!syndicateKnown
            ? "幹事団の情報は未取得です"
            : hasAllocation
              ? "申込先の参考順（幹事配分×抽選方式）"
              : "申込先の参考順（幹事配分 未取得のため主幹事・幹事の区分×抽選方式）"}
        </p>
        <BrokerPriorityList
          priorities={priorities}
          includeBrokers={brokers}
          syndicateKnown={syndicateKnown}
          renderAction={(broker) => (
            <BbStatusSelect
              value={getEntry(ipo.code, broker.id).status}
              onChange={(status) => setStatus(ipo.code, broker.id, status)}
            />
          )}
        />
      </div>
    </Card>
  );
}
