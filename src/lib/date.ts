// ISO 日付（YYYY-MM-DD）の共通ヘルパ。純関数（Date.now を使わない）。
// タイムゾーンの影響を避けるため UTC 0時として計算する。

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** iso に days 日を加えた ISO 日付を返す（負数で過去日）。月末・うるう年は暦どおりに繰り上がる。 */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** fromIso から toIso までの日数（toIso が前なら負数）。 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

/** 日本時間（UTC+9、夏時間なし）のオフセット。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本時間での今日（YYYY-MM-DD）。now 省略時は現在時刻を使う（この関数だけ例外的に Date を参照する）。
 * SSG でビルド日に固定された todayIso をクライアント側で更新する用途。
 */
export function jstTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
