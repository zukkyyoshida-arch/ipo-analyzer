import path from "node:path";
import { fileURLToPath } from "node:url";

// enrich（96ut 補完データ取得）全体の設定値。
// ポライトアクセス（1 req/秒・タイムアウト・UA明示・失敗はスキップ）を徹底する。

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** リポジトリルート（scripts/enrich/ の2つ上）。 */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 出力先ディレクトリ。 */
export const DATA_DIR = path.join(REPO_ROOT, "public", "data");

export const FILES = {
  base: path.join(DATA_DIR, "ipos.base.json"),
  auto: path.join(DATA_DIR, "ipos.auto.json"),
  enriched: path.join(DATA_DIR, "ipos.enriched.json"),
} as const;

/** 96ut 株式サイトのベースURL（末尾スラッシュなし）。 */
export const BASE_URL = "https://kabu.96ut.com";

/** サイトマップインデックス。 */
export const SITEMAP_INDEX_URL = `${BASE_URL}/sitemap.xml`;

/** IPO カテゴリ一覧（サイトマップ取得失敗時のフォールバック）。 */
export const CATEGORY_URL = `${BASE_URL}/article/category/ipo/`;

/** カテゴリ一覧フォールバックで辿る最大ページ数。 */
export const CATEGORY_MAX_PAGES = 10;

/** User-Agent を明示（個人利用・ポライトアクセスの一環）。 */
export const USER_AGENT =
  "ipo-analyzer-enrich/1.0 (+personal use; polite 1 req/sec)";

/** HTTP タイムアウト（ミリ秒）。 */
export const HTTP_TIMEOUT_MS = 20_000;

/** リクエスト間隔（ミリ秒）。1 req/秒を守る。 */
export const REQUEST_INTERVAL_MS = 1_000;
