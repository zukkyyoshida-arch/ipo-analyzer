import Link from "next/link";
import type { FundLockGroup } from "@/lib/bb/fundLock";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { formatDate } from "@/lib/format";

/** 拘束期間を「開始〜終了」で表示（同日なら1日だけ）。 */
function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  return `${formatDate(start)}〜${formatDate(end)}`;
}

/**
 * 資金拘束の重なり。同一証券会社で拘束期間が重なる（2件以上）グループだけをカードで列挙する。
 * 表示対象が0件ならセクションごと描画しない。
 * @param groups groupOverlappingLocks の結果
 */
export function FundLockCalendar({ groups }: { groups: FundLockGroup[] }) {
  const overlapping = groups.filter((g) => g.overlapping.length >= 2);
  if (overlapping.length === 0) return null;

  return (
    <Section
      title="資金拘束の重なり"
      note="前受金が必要な口座で、申込予定・申込済の拘束期間が重なる組み合わせ（目安）"
    >
      <div className="space-y-3">
        {overlapping.map((group) => (
          <Card
            key={`${group.broker.id}-${group.overlapping[0].start}`}
            className="p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-bold text-text">{group.broker.name}</p>
              <p className="text-xs text-muted">
                {group.overlapping.length}件が重なる
              </p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-muted">同時拘束の最大目安</p>
                <p className="text-lg font-bold text-warn tabular-nums">
                  {group.peakAmount.toLocaleString()}
                  <span className="ml-0.5 text-xs font-normal text-muted">円</span>
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">合計目安</p>
                <p className="text-lg font-bold text-text tabular-nums">
                  {group.totalAmount.toLocaleString()}
                  <span className="ml-0.5 text-xs font-normal text-muted">円</span>
                </p>
              </div>
            </div>
            <ul className="mt-2">
              {group.overlapping.map((period) => (
                <li
                  key={period.ipo.code}
                  className="border-t border-border first:border-t-0"
                >
                  <Link
                    href={`/ipo/${period.ipo.code}`}
                    className="flex min-h-11 items-center justify-between gap-3 py-1.5 active:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-text">
                        {period.ipo.name}
                      </span>
                      <span className="block text-[11px] text-muted tabular-nums">
                        {formatRange(period.start, period.end)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-text tabular-nums">
                      {period.amount.toLocaleString()}円
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        拘束期間は購入申込期間（無ければBB期間開始〜抽選日）、金額は公開価格（未定なら仮条件上限）×100株の機械的な目安です。
      </p>
    </Section>
  );
}
