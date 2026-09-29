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
 * 「今日」の基準はこれに統一する。Workers（サーバー）は UTC で動くため、`new Date().toISOString()` の
 * 日付をそのまま使うと JST の 0:00〜8:59 が前日扱いになる。実行環境のタイムゾーンには依存しない。
 * 用途: ページ（Server Component）が todayIso を計算して渡す／SSG でビルド日に固定された値をクライアントで更新する。
 */
export function jstTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

const JST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * ISO 日時を日本時間の「YYYY/MM/DD HH:mm」に整形する。パースできない値はそのまま返す。
 * 実行環境のタイムゾーンに依存しない（サーバー UTC とブラウザ JST でハイドレーションがずれない）。
 */
export function formatJstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = JST_DATE_TIME_FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
