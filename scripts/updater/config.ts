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
  /** enrich:data が書く補完データ（updater は読むだけ。hot.json の公開価格の補完に使う） */
  enriched: path.join(DATA_DIR, "ipos.enriched.json"),
  /** いま熱い銘柄（scripts/updater/hot.ts） */
  hot: path.join(DATA_DIR, "hot.json"),
  /** 大量保有報告書（scripts/updater/holdings.ts） */
  holdings: path.join(DATA_DIR, "holdings.json"),
  /** 大量保有の発行会社 EDINET コード → 証券コード（IPO 銘柄の分だけ。Worker の日中取得が使う） */
  holdingsIssuers: path.join(DATA_DIR, "holdings-issuers.json"),
  /** 中長期セカンダリ（scripts/updater/midterm.ts） */
  midterm: path.join(DATA_DIR, "midterm.json"),
} as const;

/** updater のキャッシュ置き場（EDINET コードリストなど。gitignore 済み）。 */
export const CACHE_DIR = path.join(REPO_ROOT, "scripts", "updater", ".cache");

/** JPX 新規上場会社情報ページ。 */
export const JPX_NEW_LISTINGS_URL =
  "https://www.jpx.co.jp/listing/stocks/new/index.html";

// HTTP タイムアウト・User-Agent は httpConfig.ts（Node に依存しないので Worker からも読める）。
export { HTTP_TIMEOUT_MS, USER_AGENT } from "./httpConfig";


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
