import type { IpoStatus } from "../../src/types/ipo";

// 日付から status を自動判定する純関数。
// upcoming → bb_open → priced → listed の順で、today と各期間を突き合わせる。

export interface StatusDates {
  bbStart: string;
  bbEnd: string;
  listingDate: string;
}

/** today(YYYY-MM-DD) と各日付から status を導く。日付欠損時は upcoming を既定にする。 */
export function deriveStatus(dates: StatusDates, today: string): IpoStatus {
  const t = today;
  if (dates.listingDate && t >= dates.listingDate) return "listed";
  // BB終了後〜上場前は公開価格決定フェーズ。
  if (dates.bbEnd && t > dates.bbEnd) return "priced";
  // BB期間中。
  if (dates.bbStart && dates.bbEnd && t >= dates.bbStart && t <= dates.bbEnd) {
    return "bb_open";
  }
  return "upcoming";
}
