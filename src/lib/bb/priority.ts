import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { UnderwriterAllocation } from "@/types/enriched";

// BB申込先の優先順位（口座選びの参考値）を算出する純関数群。
// 銘柄内の最大配分比率を100とした正規化値×抽選方式係数を主、配分データが無い銘柄では
// 主幹事60/幹事30の固定点をフォールバックとする。配分データがあるのに照合できない幹事は末尾に回す。

export interface BrokerPriorityEntry {
  broker: Broker;
  /** 0〜100の優先度スコア（口座選びの参考値、高いほど当選期待値が高い目安）。 */
  priorityScore: number;
  /** 幹事団内での割当株数比率（%）。取得不能なら null。 */
  allocationRatioPercent: number | null;
  /** 主幹事かどうか。 */
  isLead: boolean;
  /** 幹事団に含まれるか（主幹事含む）。 */
  inSyndicate: boolean;
  /**
   * 配分データがある銘柄なのに、この証券会社の配分行を照合できなかったか。
   * true のとき priorityScore は 0（算出対象外）で、並びは末尾。
   */
  allocationMissing: boolean;
  reason: string;
}

const LOTTERY_TYPE_COEFFICIENT: Record<Broker["lotteryType"], number> = {
  equal: 1.0,
  point: 0.9,
  stage: 0.8,
  proportional: 0.7,
};

export const LOTTERY_TYPE_LABELS: Record<Broker["lotteryType"], string> = {
  equal: "完全平等",
  point: "ポイント制",
  stage: "ステージ制",
  proportional: "比例配分",
};

/** 前受金なしの証券会社へのボーナス。 */
const NO_DEPOSIT_BONUS = 5;
/** 配分未取得時のフォールバック基礎点。 */
const FALLBACK_LEAD_POINTS = 60;
const FALLBACK_MEMBER_POINTS = 30;

/**
 * 証券会社名を突合用に正規化する。
 * NFKC で全角英数・括弧を半角化 → 括弧以降（別名・旧社名）を除去 → 空白除去 →
 * 「證」を「証」に統一 → 末尾の「証券」を除去 → 英字は大文字化。
 * 例: 「岡三証券（岡三オンライン）」→「岡三」、「野村證券」→「野村」、「ＳＢＩ証券」→「SBI」。
 */
export function normalizeBrokerName(name: string): string {
  let s = name.normalize("NFKC");
  const paren = s.search(/[(\[【]/);
  if (paren >= 0) s = s.slice(0, paren);
  s = s.replace(/\s+/g, "").replace(/證/g, "証");
  s = s.replace(/株式会社/g, "");
  s = s.replace(/証券$/, "");
  return s.toUpperCase();
}

/** 2つの証券会社名が同一社を指すか（正規化後の完全一致。空文字は不一致）。 */
export function isSameBrokerName(a: string, b: string): boolean {
  const na = normalizeBrokerName(a);
  if (na === "") return false;
  return na === normalizeBrokerName(b);
}

/**
 * 96ut 等の外部表記の証券会社名を、証券会社マスタ（DEFAULT_BROKERS 等）から探す。
 * 見つからなければ undefined。
 */
export function matchBrokerName(
  name: string,
  brokers: Broker[],
): Broker | undefined {
  return brokers.find((b) => isSameBrokerName(name, b.name));
}

/**
 * 主幹事欄の文字列（共同主幹事は「・」「、」「/」区切り）に broker が含まれるか。
 * 区切りで社名が割れても、マスタ側の社名と一致する断片があれば主幹事とみなす。
 */
export function isLeadBroker(broker: Broker, leadUnderwriter: string): boolean {
  const text = leadUnderwriter.trim();
  if (text === "") return false;
  if (isSameBrokerName(text, broker.name)) return true;
  return text
    .split(/[・、,，/／]/)
    .some((part) => isSameBrokerName(part, broker.name));
}

/** 0〜100に丸め（小数1桁）。 */
function clampScore(value: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped * 10) / 10;
}

function formatRatio(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * 1銘柄について、証券会社ごとの申込優先順位を算出する。
 *
 * 配分比率が取れた証券会社:
 *   priorityScore = 配分比率 ÷ 銘柄内の最大配分比率 × 100 × 抽選方式係数 ＋（前受金なしなら +5）を 0〜100 に丸め
 * 配分データがある銘柄で、配分行を照合できなかった幹事団メンバー:
 *   「幹事配分 未取得」として priorityScore 0・allocationMissing: true で末尾に回す
 * 配分データが無い銘柄（allocations 未取得・有効な比率が1件も無い）、または配分行はあるが比率が null:
 *   主幹事60点 / 幹事30点 に抽選方式係数を掛け、前受金ボーナスを加算
 * 幹事団（allocations・ipo.underwriters・ipo.leadUnderwriter のいずれか）に含まれない証券会社は除外。
 * 並びは allocationMissing でないもの → 降順（同点は inSyndicate→isLead→allocationRatioPercent降順→名前順）。
 * @param ipo 対象銘柄
 * @param brokers 証券会社マスタ
 * @param allocations 96ut 由来の幹事団割当（未取得なら undefined）
 */
export function rankBrokersForIpo(
  ipo: Ipo,
  brokers: Broker[],
  allocations: UnderwriterAllocation[] | undefined,
): BrokerPriorityEntry[] {
  const allocs = allocations ?? [];
  const validRatios = allocs
    .map((a) => a.ratioPercent)
    .filter((r): r is number => r !== null && Number.isFinite(r) && r > 0);
  // 配分データがあるか（有効な比率が1件以上）。正規化の分母は銘柄内の最大配分比率。
  const maxRatio = validRatios.length > 0 ? Math.max(...validRatios) : null;
  const entries: BrokerPriorityEntry[] = [];

  for (const broker of brokers) {
    const alloc = allocs.find((a) => isSameBrokerName(a.name, broker.name));
    const isLead = isLeadBroker(broker, ipo.leadUnderwriter);
    const inUnderwriters = ipo.underwriters.some((u) =>
      isSameBrokerName(u, broker.name),
    );
    const inSyndicate = isLead || inUnderwriters || alloc !== undefined;
    if (!inSyndicate) continue;

    const coefficient = LOTTERY_TYPE_COEFFICIENT[broker.lotteryType];
    const bonus = broker.requiresDeposit ? 0 : NO_DEPOSIT_BONUS;
    const lotteryLabel = LOTTERY_TYPE_LABELS[broker.lotteryType];
    const depositText = broker.requiresDeposit ? "" : "・前受金なし";
    const ratio =
      alloc && alloc.ratioPercent !== null && Number.isFinite(alloc.ratioPercent)
        ? alloc.ratioPercent
        : null;

    let priorityScore: number;
    let reason: string;
    const allocationMissing = maxRatio !== null && alloc === undefined;
    if (allocationMissing) {
      priorityScore = 0;
      reason = `幹事配分 未取得（配分表と照合できず）・${lotteryLabel}${depositText}`;
    } else if (ratio !== null && maxRatio !== null) {
      priorityScore = clampScore((ratio / maxRatio) * 100 * coefficient + bonus);
      reason = `幹事配分${formatRatio(ratio)}%・${lotteryLabel}${depositText}`;
    } else {
      const basePoints = isLead ? FALLBACK_LEAD_POINTS : FALLBACK_MEMBER_POINTS;
      priorityScore = clampScore(basePoints * coefficient + bonus);
      reason = `幹事配分 未取得・${lotteryLabel}${depositText}`;
    }

    entries.push({
      broker,
      priorityScore,
      allocationRatioPercent: ratio,
      isLead,
      inSyndicate,
      allocationMissing,
      reason,
    });
  }

  return entries.sort(compareEntries);
}

function compareEntries(a: BrokerPriorityEntry, b: BrokerPriorityEntry): number {
  if (a.allocationMissing !== b.allocationMissing) return a.allocationMissing ? 1 : -1;
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.inSyndicate !== b.inSyndicate) return a.inSyndicate ? -1 : 1;
  if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
  const ra = a.allocationRatioPercent ?? -1;
  const rb = b.allocationRatioPercent ?? -1;
  if (rb !== ra) return rb - ra;
  return a.broker.name.localeCompare(b.broker.name, "ja");
}
