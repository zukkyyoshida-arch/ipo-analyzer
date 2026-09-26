import type { Broker } from "@/types/broker";

// 主要証券会社マスタ（デフォルト値）。
// underwriterCoefficient は需給スコアの主幹事項目に使う係数（-2〜+2）。
// デフォルトは大手5社（SBI/SMBC日興/野村/大和/みずほ）を +1、その他を 0 とする。
// ユーザーは設定画面で係数を調整できる（localStorage に保存）。
export const DEFAULT_BROKERS: Broker[] = [
  {
    id: "sbi",
    name: "SBI証券",
    lotteryType: "point",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 1,
  },
  {
    id: "smbc-nikko",
    name: "SMBC日興証券",
    lotteryType: "stage",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 1,
  },
  {
    id: "nomura",
    name: "野村證券",
    lotteryType: "proportional",
    requiresDeposit: false,
    penaltyOnCancel: false,
    underwriterCoefficient: 1,
  },
  {
    id: "daiwa",
    name: "大和証券",
    lotteryType: "proportional",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 1,
  },
  {
    id: "mizuho",
    name: "みずほ証券",
    lotteryType: "proportional",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 1,
  },
  {
    id: "monex",
    name: "マネックス証券",
    lotteryType: "equal",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 0,
  },
  {
    id: "rakuten",
    name: "楽天証券",
    lotteryType: "equal",
    requiresDeposit: true,
    penaltyOnCancel: false,
    underwriterCoefficient: 0,
  },
  {
    id: "matsui",
    name: "松井証券",
    lotteryType: "equal",
    requiresDeposit: false,
    penaltyOnCancel: false,
    underwriterCoefficient: 0,
  },
];

/** SBI証券のID。チャレンジポイント投入メモ欄の表示判定に使う */
export const SBI_BROKER_ID = "sbi";

export function findBroker(brokers: Broker[], id: string): Broker | undefined {
  return brokers.find((b) => b.id === id);
}

export function findBrokerByName(
  brokers: Broker[],
  name: string,
): Broker | undefined {
  return brokers.find((b) => b.name === name);
}
