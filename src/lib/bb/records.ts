import type { Ipo } from "@/types/ipo";
import type { Broker, BbStatus } from "@/types/broker";
import type { BbState } from "@/types/userData";

// 自分の BB 申込記録の振り返り（口座別の申込数・当選数・当選率、初値売り想定損益）を集計する純関数。
// 数値は記録からの機械的集計で、手数料・税金は考慮しない。

/** 「申込」として数えるステータス（申込予定・未対応は含めない）。 */
const APPLIED_STATUSES: BbStatus[] = [
  "applied",
  "won",
  "waitlist",
  "lost",
  "declined",
  "purchased",
];
/** 当選として数えるステータス（当選後の辞退・購入済を含む）。 */
const WON_STATUSES: BbStatus[] = ["won", "declined", "purchased"];
/** 初値売り想定損益の対象（当選・購入済。辞退は含めない）。 */
const PNL_STATUSES: BbStatus[] = ["won", "purchased"];
/** 1枚あたりの株数。 */
const SHARES_PER_UNIT = 100;
/** 当選率の母数がこれ未満なら「目安として弱い」。 */
export const WEAK_SAMPLE_THRESHOLD = 5;

export interface RecordCounts {
  /** 申込数（申込済・当選・補欠・落選・辞退・購入済） */
  applied: number;
  /** 当選数（当選・辞退・購入済） */
  won: number;
  waitlist: number;
  lost: number;
  /** 結果判明分（当選＋補欠＋落選）。当選率の母数 */
  decided: number;
  /** 当選率（0〜1）。結果判明分が0なら null */
  winRate: number | null;
}

export interface BrokerRecordSummary extends RecordCounts {
  broker: Broker;
}

export interface MyRecordsSummary {
  /** 申込が1件以上ある証券会社のみ（証券会社マスタ順） */
  perBroker: BrokerRecordSummary[];
  totals: RecordCounts;
  estimatedPnl: {
    /** 試算に使えた記録数（当選・購入済で公開価格・初値の両方あり） */
    count: number;
    /** 初値売り想定損益（円）。count が0なら null */
    amount: number | null;
    /** 公開価格または初値が欠損して除外した記録数 */
    excludedCount: number;
  };
  /** 母数の注記（例: 「結果判明3件。母数が少なく目安として弱い」） */
  sampleNote: string;
}

function emptyCounts(): Omit<RecordCounts, "decided" | "winRate"> {
  return { applied: 0, won: 0, waitlist: 0, lost: 0 };
}

function finalize(c: Omit<RecordCounts, "decided" | "winRate">): RecordCounts {
  const decided = c.won + c.waitlist + c.lost;
  return { ...c, decided, winRate: decided > 0 ? c.won / decided : null };
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 申込記録を口座別・合計で集計し、当選・購入済の初値売り想定損益を試算する。
 * 証券会社マスタに無い口座IDの記録は集計しない。
 * @param ipos 全銘柄（公開価格・初値の参照用）
 * @param brokers 証券会社マスタ
 * @param bbState 申込記録（銘柄コード→証券会社ID→ステータス）
 */
export function summarizeMyRecords(
  ipos: Ipo[],
  brokers: Broker[],
  bbState: BbState,
): MyRecordsSummary {
  const ipoByCode = new Map(ipos.map((ipo) => [ipo.code, ipo]));
  const perBrokerCounts = new Map(brokers.map((b) => [b.id, emptyCounts()]));
  const total = emptyCounts();
  let pnlCount = 0;
  let pnlAmount = 0;
  let excludedCount = 0;

  for (const [code, records] of Object.entries(bbState)) {
    for (const [brokerId, entry] of Object.entries(records ?? {})) {
      const counts = perBrokerCounts.get(brokerId);
      if (!counts || !entry) continue;
      const status = entry.status;
      if (!APPLIED_STATUSES.includes(status)) continue;
      counts.applied += 1;
      total.applied += 1;
      if (WON_STATUSES.includes(status)) {
        counts.won += 1;
        total.won += 1;
      } else if (status === "waitlist") {
        counts.waitlist += 1;
        total.waitlist += 1;
      } else if (status === "lost") {
        counts.lost += 1;
        total.lost += 1;
      }

      if (PNL_STATUSES.includes(status)) {
        const ipo = ipoByCode.get(code);
        const offering = ipo?.offeringPrice;
        const initial = ipo?.initialPrice;
        if (isFiniteNumber(offering) && isFiniteNumber(initial)) {
          pnlCount += 1;
          pnlAmount += (initial - offering) * SHARES_PER_UNIT;
        } else {
          excludedCount += 1;
        }
      }
    }
  }

  const perBroker = brokers
    .map((broker) => ({ broker, ...finalize(perBrokerCounts.get(broker.id) ?? emptyCounts()) }))
    .filter((s) => s.applied > 0);
  const totals = finalize(total);

  const sampleNote =
    totals.decided < WEAK_SAMPLE_THRESHOLD
      ? `結果判明${totals.decided}件。母数が少なく目安として弱い`
      : `結果判明${totals.decided}件の実績分布`;

  return {
    perBroker,
    totals,
    estimatedPnl: {
      count: pnlCount,
      amount: pnlCount > 0 ? pnlAmount : null,
      excludedCount,
    },
    sampleNote,
  };
}
