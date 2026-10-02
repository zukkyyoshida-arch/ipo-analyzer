// 優待の候補から外す銘柄の判定（純関数）。データ（public/data/yutai/）は銘柄を消さず、印だけを持つ。
// - 廃止: yutaiStatus = "abolished"（常に除外）
// - 決算またぎ: 次の権利月の「買い開始日〜権利付最終日」に nextEarningsDate が入る（opts で除外するか選べる）
// 期間は src/lib/calendar/yutaiDates.ts の nextYutaiSchedule（権利付最終日が今日以降のもの）。

import { nextYutaiSchedule } from "../calendar/yutaiDates";
import type { YutaiItem } from "./types";

export type YutaiExclusionReason = "abolished" | "earnings";

/** 決算発表予定日が、次の権利月の買い開始日〜権利付最終日（両端含む）に入るか。日付が無ければ false。 */
export function earningsInWindow(item: Pick<YutaiItem, "nextEarningsDate">, rightsMonth: number, todayIso: string): boolean {
  const d = item.nextEarningsDate;
  if (!d) return false;
  const s = nextYutaiSchedule(rightsMonth, todayIso);
  return d >= s.buyStart && d <= s.lastCumDate;
}

/** 除外の理由。廃止を優先。除外しなければ null。 */
export function yutaiExclusion(
  item: Pick<YutaiItem, "yutaiStatus" | "nextEarningsDate">,
  rightsMonth: number,
  todayIso: string,
): YutaiExclusionReason | null {
  if (item.yutaiStatus === "abolished") return "abolished";
  if (earningsInWindow(item, rightsMonth, todayIso)) return "earnings";
  return null;
}

/** 表示する銘柄と除外した銘柄に分ける。廃止は常に除外、決算またぎは hideEarnings のときだけ。順序は保つ。 */
export function splitExcluded<T extends Pick<YutaiItem, "yutaiStatus" | "nextEarningsDate">>(
  items: T[],
  rightsMonth: number,
  todayIso: string,
  opts: { hideEarnings: boolean },
): { shown: T[]; excluded: { item: T; reason: YutaiExclusionReason }[] } {
  const shown: T[] = [];
  const excluded: { item: T; reason: YutaiExclusionReason }[] = [];
  for (const item of items) {
    const reason = yutaiExclusion(item, rightsMonth, todayIso);
    if (reason === "abolished" || (reason === "earnings" && opts.hideEarnings)) excluded.push({ item, reason });
    else shown.push(item);
  }
  return { shown, excluded };
}
