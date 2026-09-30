// HTTP の設定値（node:path などに依存しない。Cloudflare Worker の日中取得からも読む）。

/** HTTP タイムアウト（ミリ秒）。 */
export const HTTP_TIMEOUT_MS = 20_000;

/** User-Agent を明示（個人利用・ポライトアクセスの一環）。 */
export const USER_AGENT =
  "ipo-analyzer-updater/1.0 (+personal use; polite single-page fetch)";
