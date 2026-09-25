import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import type { BbEntry } from "@/types/userData";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ListRow } from "@/components/ui/ListRow";
import { BbStatusSelect } from "@/components/BbStatusSelect";
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
 * BB画面の銘柄カード。銘柄名・コード・BB期間・抽選日・購入期間・公開価格を上段に、
 * 証券会社ごとのBB申込ステータス行を下段に表示する。
 * @param ipo 対象銘柄
 * @param brokers 証券会社一覧
 * @param getEntry 銘柄コード×証券会社IDのBB申込レコード取得
 * @param setStatus BB申込ステータスの更新
 */
export function BbIpoCard({
  ipo,
  brokers,
  getEntry,
  setStatus,
}: {
  ipo: Ipo;
  brokers: Broker[];
  getEntry: (code: string, brokerId: string) => BbEntry;
  setStatus: (code: string, brokerId: string, status: BbStatus) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/ipo/${ipo.code}`}
            className="flex min-h-11 items-center"
          >
            <span className="truncate font-bold text-text hover:underline">
              {ipo.name}
            </span>
          </Link>
          <p className="-mt-1 text-xs text-muted">
            {ipo.code}・{ipo.market}
          </p>
        </div>
        <Chip tone="neutral" className="shrink-0">
          {STATUS_LABELS[ipo.status]}
        </Chip>
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

      <div className="mt-3 space-y-2.5">
        {brokers.map((broker) => {
          const entry = getEntry(ipo.code, broker.id);
          const isLead = broker.name === ipo.leadUnderwriter;
          return (
            <div
              key={broker.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <span className="text-sm text-text">{broker.name}</span>
                {isLead && (
                  <Chip tone="accent" className="ml-1.5">
                    主幹事
                  </Chip>
                )}
              </div>
              <div className="min-w-[7.5rem]">
                <BbStatusSelect
                  value={entry.status}
                  onChange={(status) => setStatus(ipo.code, broker.id, status)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
