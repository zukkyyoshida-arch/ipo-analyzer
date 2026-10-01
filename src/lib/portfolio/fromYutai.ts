// 優待の行から保有中リストへ 1 タップで足すための純関数。
// 買値＝いまの株価、株数＝推奨株数（資金未指定・枠超えなら 100 株）、戦略＝優待、権利確定月＝表示中の月、買付日＝今日。

import { isOpen, type Holding } from "./types";

/** 資金未指定・枠で 100 株も買えないときの株数（1 単元）。 */
export const YUTAI_HOLDING_DEFAULT_SHARES = 100;

export interface YutaiHoldingInput {
  id: string;
  code: string;
  name: string;
  /** いまの株価（円）。無ければ追加できない */
  price: number | null;
  /** 推奨株数。null・0 なら 100 株 */
  shares: number | null;
  /** 権利確定月（1〜12） */
  rightsMonth: number;
  /** 今日（YYYY-MM-DD） */
  todayIso: string;
}

/** 優待の行から保有 1 件を作る。株価が無ければ null。 */
export function holdingFromYutai(input: YutaiHoldingInput): Holding | null {
  const { price } = input;
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const shares = input.shares !== null && input.shares > 0 ? input.shares : YUTAI_HOLDING_DEFAULT_SHARES;
  return {
    id: input.id,
    code: input.code,
    name: input.name,
    buyPrice: Math.round(price * 10) / 10,
    shares,
    buyDate: input.todayIso,
    strategy: "yutai",
    rightsMonth: input.rightsMonth,
    earningsDate: null,
    memo: "",
    manualPrice: null,
    sold: null,
  };
}

/** その銘柄をその権利確定月の優待として保有中か（売却済みは数えない）。 */
export function isHeldForYutai(holdings: Holding[], code: string, rightsMonth: number): boolean {
  return holdings.some((h) => isOpen(h) && h.code === code && h.strategy === "yutai" && h.rightsMonth === rightsMonth);
}
