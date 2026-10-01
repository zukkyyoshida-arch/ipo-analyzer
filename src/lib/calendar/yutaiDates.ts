// 優待（権利確定月 M）の売買日付。純関数。
// - 買い開始日   = M−1 月の最初の営業日（前月の月初に買う）
// - 権利付最終日 = M 月の最終営業日の 2 営業日前（受渡しは T+2。2019 年 7 月から。「3 営業日前」は旧制度）
// - 権利落ち日   = 権利付最終日の翌営業日
// 権利確定日は月末として扱う（20 日・15 日締めの銘柄は手動の予定で補う）。

import { daysBetween } from "../date";
import {
  addBusinessDays,
  firstBusinessDayOfMonth,
  lastBusinessDayOfMonth,
  nextBusinessDay,
} from "./businessDays";

export interface YutaiSchedule {
  /** 権利確定月の年 */
  year: number;
  /** 権利確定月（1〜12） */
  month: number;
  /** 買い開始日（前月の最初の営業日） */
  buyStart: string;
  /** 権利付最終日 */
  lastCumDate: string;
  /** 権利落ち日 */
  exDate: string;
}

/** year 年 month 月が権利確定月のときの日付。 */
export function yutaiSchedule(year: number, month: number): YutaiSchedule {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const lastCumDate = addBusinessDays(lastBusinessDayOfMonth(year, month), -2);
  return {
    year,
    month,
    buyStart: firstBusinessDayOfMonth(prevYear, prevMonth),
    lastCumDate,
    exDate: nextBusinessDay(lastCumDate),
  };
}

/**
 * todayIso から見て次に来る、権利確定月 month の日付（権利付最終日が今日以降のもの）。
 * 今年の権利付最終日を過ぎていれば来年。
 */
export function nextYutaiSchedule(month: number, todayIso: string): YutaiSchedule {
  const year = Number(todayIso.slice(0, 4));
  const thisYear = yutaiSchedule(year, month);
  return thisYear.lastCumDate >= todayIso ? thisYear : yutaiSchedule(year + 1, month);
}

/** 権利付最終日まであと何日か（暦日。当日は 0）。 */
export function daysUntilLastCum(month: number, todayIso: string): number {
  return daysBetween(todayIso, nextYutaiSchedule(month, todayIso).lastCumDate);
}

/** fromIso〜toIso（両端含む）に買い開始日・権利付最終日・権利落ち日のどれかが入る権利確定月の日付一覧。 */
export function yutaiSchedulesInRange(fromIso: string, toIso: string): YutaiSchedule[] {
  const fromYear = Number(fromIso.slice(0, 4));
  const toYear = Number(toIso.slice(0, 4));
  const out: YutaiSchedule[] = [];
  // 1 月権利の買い開始日は前年 12 月なので、翌年ぶんまで見る。
  for (let y = fromYear; y <= toYear + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const s = yutaiSchedule(y, m);
      if ([s.buyStart, s.lastCumDate, s.exDate].some((d) => d >= fromIso && d <= toIso)) out.push(s);
    }
  }
  return out;
}
