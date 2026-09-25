import path from "node:path";
import { fileURLToPath } from "node:url";

// updater 全体の設定値。ポライトアクセス（1リクエスト・タイムアウト・UA明示）を徹底する。

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** リポジトリルート（scripts/updater/ の2つ上）。 */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 出力先ディレクトリ。 */
export const DATA_DIR = path.join(REPO_ROOT, "public", "data");

export const FILES = {
  base: path.join(DATA_DIR, "ipos.base.json"),
  auto: path.join(DATA_DIR, "ipos.auto.json"),
  market: path.join(DATA_DIR, "market.json"),
} as const;

/** JPX 新規上場会社情報ページ。 */
export const JPX_NEW_LISTINGS_URL =
  "https://www.jpx.co.jp/listing/stocks/new/index.html";

/** HTTP タイムアウト（ミリ秒）。 */
export const HTTP_TIMEOUT_MS = 20_000;

/** User-Agent を明示（個人利用・ポライトアクセスの一環）。 */
export const USER_AGENT =
  "ipo-analyzer-updater/1.0 (+personal use; polite single-page fetch)";

/** 指数・ETF のティッカー。 */
export const TICKERS = {
  nikkei: "^N225",
  growth250: "2516.T",
} as const;

/** 指標算出に使う終値の取得日数。 */
export const PRICE_LOOKBACK_DAYS = 45;

/** 移動平均の期間（営業日）。 */
export const MOVING_AVERAGE_PERIOD = 25;

/** 直近上場の初値騰落率平均に使う銘柄数。 */
export const RECENT_IPO_SAMPLE = 10;
