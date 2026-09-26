// 証券会社マスタと BB 申込ステータスの型定義。

export type LotteryType = "equal" | "proportional" | "stage" | "point";

export interface Broker {
  id: string;
  name: string;
  /** 抽選方式: 完全平等 / 比例（資金量） / ステージ制 / ポイント制 */
  lotteryType: LotteryType;
  /** 前受金（申込時の資金拘束）が必要か */
  requiresDeposit: boolean;
  /** 当選後の購入辞退にペナルティがあるか */
  penaltyOnCancel: boolean;
  /** 主幹事係数（需給スコアに加算、-2〜+2）。ユーザー調整可 */
  underwriterCoefficient: number;
}

/** BB（ブックビルディング）申込ステータス */
export type BbStatus =
  | "none" // 未対応
  | "planned" // 申込予定
  | "applied" // 申込済
  | "won" // 当選
  | "waitlist" // 補欠
  | "lost" // 落選
  | "declined" // 辞退
  | "purchased"; // 購入済

export const BB_STATUS_LABELS: Record<BbStatus, string> = {
  none: "未対応",
  planned: "申込予定",
  applied: "申込済",
  won: "当選",
  waitlist: "補欠",
  lost: "落選",
  declined: "辞退",
  purchased: "購入済",
};

export const BB_STATUS_ORDER: BbStatus[] = [
  "none",
  "planned",
  "applied",
  "won",
  "waitlist",
  "lost",
  "declined",
  "purchased",
];
