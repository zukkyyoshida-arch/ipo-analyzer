// 実行可否の判定（launchd は15分毎に起動するが、時間帯で頻度を変える）。
//
// ルール:
//   - 平日 8:00〜16:00 (JST): そのまま毎回実行（15分毎）
//   - それ以外の時間帯・曜日: 毎時 0〜14分のときのみ実行（実質1時間毎）
//
// JST に依存するため、判定は JST に変換した時刻で行う。

export interface ClockJst {
  /** 曜日 0(日)〜6(土) */
  day: number;
  hour: number;
  minute: number;
}

/** 与えた Date を JST の曜日・時・分に変換する。 */
export function toJst(date: Date): ClockJst {
  // UTC + 9時間 = JST。getUTC* を使い環境TZに依存しない。
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const jst = new Date(utc + 9 * 3600 * 1000);
  return { day: jst.getDay(), hour: jst.getHours(), minute: jst.getMinutes() };
}

/** 平日（月〜金）か。 */
function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5;
}

/** この時刻に更新を実行すべきか。 */
export function shouldRun(clock: ClockJst): boolean {
  const activeHours = clock.hour >= 8 && clock.hour < 16;
  if (isWeekday(clock.day) && activeHours) {
    // 取引時間帯はそのまま（15分毎）。
    return true;
  }
  // それ以外は毎時 0〜14 分のときのみ（実質1時間毎）。
  return clock.minute < 15;
}
