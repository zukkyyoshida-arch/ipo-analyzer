// 東証の営業日の判定と、営業日を数える純関数。Date.now は使わない。
// 休業日 = 土日・国民の祝日（振替休日・国民の休日を含む）・年末年始（12/31〜1/3）。
// 祝日は固定表で持つ（春分・秋分は前年 2 月に官報で公表されるため計算で出さない）。
// 出典: 内閣府「国民の祝日について」 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
//       （2025〜2027 年の一覧。2027 年の春分・秋分は国立天文台「暦要項」による）
// 表に無い年は土日と年末年始だけで判定する（hasHolidayTable で確かめられる）。毎年 2 月ごろに翌年ぶんを足す。

import { addDaysIso } from "../date";

/** 祝日（振替休日・国民の休日を含む）。年 → "MM-DD" の一覧。 */
const HOLIDAYS: Record<number, string[]> = {
  2025: [
    "01-01", // 元日
    "01-13", // 成人の日
    "02-11", // 建国記念の日
    "02-23", // 天皇誕生日
    "02-24", // 振替休日
    "03-20", // 春分の日
    "04-29", // 昭和の日
    "05-03", // 憲法記念日
    "05-04", // みどりの日
    "05-05", // こどもの日
    "05-06", // 振替休日
    "07-21", // 海の日
    "08-11", // 山の日
    "09-15", // 敬老の日
    "09-23", // 秋分の日
    "10-13", // スポーツの日
    "11-03", // 文化の日
    "11-23", // 勤労感謝の日
    "11-24", // 振替休日
  ],
  2026: [
    "01-01", // 元日
    "01-12", // 成人の日
    "02-11", // 建国記念の日
    "02-23", // 天皇誕生日
    "03-20", // 春分の日
    "04-29", // 昭和の日
    "05-03", // 憲法記念日
    "05-04", // みどりの日
    "05-05", // こどもの日
    "05-06", // 振替休日
    "07-20", // 海の日
    "08-11", // 山の日
    "09-21", // 敬老の日
    "09-22", // 国民の休日
    "09-23", // 秋分の日
    "10-12", // スポーツの日
    "11-03", // 文化の日
    "11-23", // 勤労感謝の日
  ],
  2027: [
    "01-01", // 元日
    "01-11", // 成人の日
    "02-11", // 建国記念の日
    "02-23", // 天皇誕生日
    "03-21", // 春分の日
    "03-22", // 振替休日
    "04-29", // 昭和の日
    "05-03", // 憲法記念日
    "05-04", // みどりの日
    "05-05", // こどもの日
    "07-19", // 海の日
    "08-11", // 山の日
    "09-20", // 敬老の日
    "09-23", // 秋分の日
    "10-11", // スポーツの日
    "11-03", // 文化の日
    "11-23", // 勤労感謝の日
  ],
};

const HOLIDAY_SET = new Set(
  Object.entries(HOLIDAYS).flatMap(([year, days]) => days.map((md) => `${year}-${md}`)),
);

/** その年の祝日表を持っているか（無い年は土日・年末年始だけで判定する）。 */
export function hasHolidayTable(year: number): boolean {
  return HOLIDAYS[year] !== undefined;
}

/** 国民の祝日（振替休日・国民の休日を含む）か。 */
export function isHoliday(iso: string): boolean {
  return HOLIDAY_SET.has(iso);
}

/** 年末年始の休業日（12/31〜1/3）か。 */
function isYearEndHoliday(iso: string): boolean {
  const md = iso.slice(5);
  return md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03";
}

/** 曜日（0 = 日曜 … 6 = 土曜）。 */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** 東証の営業日か（土日・祝日・年末年始でない日）。 */
export function isBusinessDay(iso: string): boolean {
  const w = weekdayOf(iso);
  if (w === 0 || w === 6) return false;
  return !isHoliday(iso) && !isYearEndHoliday(iso);
}

/** iso より後の、最初の営業日。 */
export function nextBusinessDay(iso: string): string {
  let d = addDaysIso(iso, 1);
  while (!isBusinessDay(d)) d = addDaysIso(d, 1);
  return d;
}

/** iso より前の、最後の営業日。 */
export function prevBusinessDay(iso: string): string {
  let d = addDaysIso(iso, -1);
  while (!isBusinessDay(d)) d = addDaysIso(d, -1);
  return d;
}

/** iso から n 営業日ずらした日（n < 0 で前へ）。n = 0 なら iso をそのまま返す。 */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso;
  for (let i = 0; i < Math.abs(n); i++) d = n > 0 ? nextBusinessDay(d) : prevBusinessDay(d);
  return d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 月の初日（YYYY-MM-01）。 */
export function monthStartIso(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

/** 月の末日。 */
export function monthEndIso(year: number, month: number): string {
  const next = month === 12 ? monthStartIso(year + 1, 1) : monthStartIso(year, month + 1);
  return addDaysIso(next, -1);
}

/** 月の最初の営業日。 */
export function firstBusinessDayOfMonth(year: number, month: number): string {
  const first = monthStartIso(year, month);
  return isBusinessDay(first) ? first : nextBusinessDay(first);
}

/** 月の最後の営業日。 */
export function lastBusinessDayOfMonth(year: number, month: number): string {
  const last = monthEndIso(year, month);
  return isBusinessDay(last) ? last : prevBusinessDay(last);
}
