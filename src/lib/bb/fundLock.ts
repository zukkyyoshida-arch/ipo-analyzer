import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import type { BbState } from "@/types/userData";
import { estimatedLockAmount } from "@/lib/format";

// 前受金による資金拘束期間の一覧化と、同一証券会社内での期間の重なり判定を行う純関数群。
// 重なり判定は閉区間（境界が同日なら「重なる」）。日付は YYYY-MM-DD の文字列比較で扱う。

export interface FundLockPeriod {
  ipo: Ipo;
  broker: Broker;
  /** 拘束開始日（購入申込期間の開始、無ければBB期間開始）。 */
  start: string;
  /** 拘束終了日（購入申込期間の終了、無ければ抽選日、無ければBB期間終了）。 */
  end: string;
  /** 拘束金額目安（円）。既存 estimatedLockAmount を流用。 */
  amount: number;
}

/** 同一証券会社内で期間が連鎖的に重なる拘束のまとまり。 */
export interface FundLockGroup {
  broker: Broker;
  /** 開始日昇順。 */
  overlapping: FundLockPeriod[];
  /** グループ内の拘束金額目安の合計（円）。 */
  totalAmount: number;
  /** 同じ日に同時に拘束される金額目安の最大値（円）。 */
  peakAmount: number;
}

/** 資金拘束の対象とするステータス（申込予定・申込済）。 */
export const FUND_LOCK_STATUSES: BbStatus[] = ["planned", "applied"];

/** 拘束期間（開始・終了）を導出する。どちらかが決まらなければ null。 */
function lockRange(ipo: Ipo): { start: string; end: string } | null {
  const start = ipo.purchasePeriod.start || ipo.bbPeriod.start;
  const end = ipo.purchasePeriod.end || ipo.allotmentDate || ipo.bbPeriod.end;
  if (!start || !end || end < start) return null;
  return { start, end };
}

/**
 * 「申込予定・申込済」ステータスの銘柄×証券会社（前受金が必要な証券会社のみ）について
 * 資金拘束期間の一覧を返す。日付が確定していない項目は除外する。
 * @param ipos 対象銘柄
 * @param brokers 証券会社マスタ
 * @param bbState BB申込記録（localStorage）
 * @param todayIso 今日（YYYY-MM-DD、JST）。指定時は終了日が今日より前（end < todayIso）の期間を除外する。
 *   省略時（SSR など今日が決まらないとき）は除外しない。
 */
export function buildFundLockPeriods(
  ipos: Ipo[],
  brokers: Broker[],
  bbState: BbState,
  todayIso?: string,
): FundLockPeriod[] {
  const periods: FundLockPeriod[] = [];
  for (const ipo of ipos) {
    const records = bbState[ipo.code];
    if (!records) continue;
    const range = lockRange(ipo);
    if (!range) continue;
    if (todayIso && range.end < todayIso) continue;
    for (const broker of brokers) {
      if (!broker.requiresDeposit) continue;
      const status = records[broker.id]?.status;
      if (!status || !FUND_LOCK_STATUSES.includes(status)) continue;
      periods.push({
        ipo,
        broker,
        start: range.start,
        end: range.end,
        amount: estimatedLockAmount(ipo),
      });
    }
  }
  return periods;
}

/** 2つの期間が重なっているか。境界が同日なら「重なる」とみなす（閉区間）。 */
export function periodsOverlap(
  a: Pick<FundLockPeriod, "start" | "end">,
  b: Pick<FundLockPeriod, "start" | "end">,
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** 期間集合の中で、同じ日に同時に拘束される金額の最大値。 */
function peakConcurrentAmount(periods: FundLockPeriod[]): number {
  let peak = 0;
  // 閉区間なので、最大値はいずれかの期間の開始日で必ず現れる。
  for (const p of periods) {
    const sum = periods
      .filter((q) => q.start <= p.start && p.start <= q.end)
      .reduce((acc, q) => acc + q.amount, 0);
    peak = Math.max(peak, sum);
  }
  return peak;
}

/**
 * 同一証券会社内で期間が重なるグループをまとめる（A-B、B-C が重なれば A・B・C は1グループ）。
 * 重ならない単独の期間も overlapping.length === 1 のグループとして返す。
 * 並びは グループ開始日昇順 → 証券会社名順。
 */
export function groupOverlappingLocks(periods: FundLockPeriod[]): FundLockGroup[] {
  const byBroker = new Map<string, FundLockPeriod[]>();
  for (const p of periods) {
    const list = byBroker.get(p.broker.id) ?? [];
    list.push(p);
    byBroker.set(p.broker.id, list);
  }

  const groups: FundLockGroup[] = [];
  for (const list of byBroker.values()) {
    const sorted = [...list].sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
    );
    let current: FundLockPeriod[] = [];
    let currentEnd = "";
    const flush = () => {
      if (current.length === 0) return;
      groups.push({
        broker: current[0].broker,
        overlapping: current,
        totalAmount: current.reduce((acc, p) => acc + p.amount, 0),
        peakAmount: peakConcurrentAmount(current),
      });
    };
    for (const p of sorted) {
      if (current.length > 0 && p.start <= currentEnd) {
        current.push(p);
        if (p.end > currentEnd) currentEnd = p.end;
      } else {
        flush();
        current = [p];
        currentEnd = p.end;
      }
    }
    flush();
  }

  return groups.sort(
    (a, b) =>
      a.overlapping[0].start.localeCompare(b.overlapping[0].start) ||
      a.broker.name.localeCompare(b.broker.name, "ja"),
  );
}
