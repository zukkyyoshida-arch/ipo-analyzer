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
  /** 2015〜2023 年の過去 IPO（中長期セカンダリの母集団のうち 2023 年末上場分の補完に読むだけ） */
  history: path.join(DATA_DIR, "ipos.history.json"),
  /** 大量保有報告書（scripts/updater/holdings.ts） */
  holdings: path.join(DATA_DIR, "holdings.json"),
  /** 中長期セカンダリ（scripts/updater/midterm.ts） */
  midterm: path.join(DATA_DIR, "midterm.json"),
  /** J-Quants 財務サマリ（scripts/updater/fins.ts。無料枠は約 12 週遅延） */
  fins: path.join(DATA_DIR, "fins.json"),
  /** 信用取引残高（scripts/updater/margin.ts。JPX の銘柄別信用取引残高 PDF から） */
  margin: path.join(DATA_DIR, "margin.json"),
  /** 外国法人等の持株比率（scripts/updater/foreign.ts。EDINET の有価証券報告書「所有者別状況」から） */
  foreign: path.join(DATA_DIR, "foreign.json"),
  /** 株主優待の先回り買い（scripts/updater/yutai.ts）。index.json と権利確定月ごとの <M>.json を置くディレクトリ */
  yutaiDir: path.join(DATA_DIR, "yutai"),
} as const;

/** updater のキャッシュ置き場（EDINET コードリストなど。gitignore 済み）。 */
export const CACHE_DIR = path.join(REPO_ROOT, "scripts", "updater", ".cache");

/** JPX 新規上場会社情報ページ。 */
export const JPX_NEW_LISTINGS_URL =
  "https://www.jpx.co.jp/listing/stocks/new/index.html";

/** JPX 銘柄別信用取引残高ページ（最新 PDF へのリンクを拾う）。 */
export const JPX_MARGIN_URL =
  "https://www.jpx.co.jp/markets/statistics-equities/margin/01.html";

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
