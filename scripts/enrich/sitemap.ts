import {
  BASE_URL,
  CATEGORY_MAX_PAGES,
  CATEGORY_URL,
  HTTP_TIMEOUT_MS,
  REQUEST_INTERVAL_MS,
  SITEMAP_INDEX_URL,
  USER_AGENT,
} from "./config";

// 96ut の IPO 記事URL（https://kabu.96ut.com/article/ipo/<7桁>/）を収集する。
// 第1手段: sitemap.xml（インデックス）→ post-sitemap*.xml。
// 第2手段: サイトマップが取れない場合のみ、カテゴリ一覧（page/N/ ページング）を辿る。

/** 取得結果。url はリダイレクト後の最終URL。 */
export interface FetchedText {
  text: string;
  url: string;
}

/** テキスト取得関数（テストで差し替え可能にするため注入する）。失敗時は例外を投げる。 */
export type FetchText = (url: string) => Promise<FetchedText>;

export interface CollectOptions {
  fetchText?: FetchText;
  /** リクエスト間の待機（テストでは即時解決にする）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 警告ログ出力先（既定 console.warn）。 */
  warn?: (message: string) => void;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** UA 明示・タイムアウト付きで GET する（既定の FetchText）。HTTP エラーは例外。 */
export const politeFetchText: FetchText = async (url) => {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ja,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return { text: await res.text(), url: res.url || url };
};

// 絶対URL、または引用符直後のルート相対パス（カテゴリ一覧HTMLの href 用）を対象にする。
const ARTICLE_URL_PATTERN =
  /(?:https?:\/\/kabu\.96ut\.com|["'])\/article\/ipo\/(\d{7})(?=[\/"'<\s]|$)/g;

/** 記事番号（7桁）から正規化済みURLを作る。 */
export function articleUrlFromNumber(articleNumber: string): string {
  return `${BASE_URL}/article/ipo/${articleNumber}/`;
}

/** 記事URLから7桁の記事番号を取り出す。該当しなければ null。 */
export function articleNumberFromUrl(url: string): string | null {
  const m = url.match(/\/article\/ipo\/(\d{7})\/?/);
  return m ? m[1] : null;
}

/**
 * サイトマップXML（またはカテゴリ一覧HTML）から `article/ipo/<7桁>/` のURLだけを抽出する。
 * 重複排除し、記事番号の昇順で返す。
 */
export function extractIpoArticleUrls(sitemapXml: string): string[] {
  const numbers = new Set<string>();
  for (const m of sitemapXml.matchAll(ARTICLE_URL_PATTERN)) {
    numbers.add(m[1]);
  }
  return Array.from(numbers)
    .sort()
    .map((n) => articleUrlFromNumber(n));
}

/** サイトマップインデックスXMLから post-sitemap*.xml のURLを抽出する。 */
export function extractPostSitemapUrls(indexXml: string): string[] {
  const urls = new Set<string>();
  for (const m of indexXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    if (/\/post-sitemap\d*\.xml$/.test(m[1])) urls.add(m[1]);
  }
  // post-sitemap.xml, post-sitemap2.xml, ... の番号順。
  const order = (u: string) => {
    const n = u.match(/post-sitemap(\d*)\.xml$/);
    return n && n[1] ? Number(n[1]) : 1;
  };
  return Array.from(urls).sort((a, b) => order(a) - order(b));
}

/** サイトマップインデックスを取得し、post-sitemap*.xml のURL一覧を返す。 */
export async function fetchSitemapIndex(
  fetchText: FetchText = politeFetchText,
): Promise<string[]> {
  const { text } = await fetchText(SITEMAP_INDEX_URL);
  return extractPostSitemapUrls(text);
}

/** カテゴリ一覧（page/N/）を最大 CATEGORY_MAX_PAGES ページ辿って記事URLを集める。 */
export async function collectFromCategory(
  options: CollectOptions = {},
  maxPages: number = CATEGORY_MAX_PAGES,
): Promise<string[]> {
  const fetchText = options.fetchText ?? politeFetchText;
  const wait = options.sleep ?? sleep;
  const warn = options.warn ?? console.warn;
  const found = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? CATEGORY_URL : `${CATEGORY_URL}page/${page}/`;
    if (page > 1) await wait(REQUEST_INTERVAL_MS);
    try {
      const { text } = await fetchText(url);
      const before = found.size;
      for (const u of extractIpoArticleUrls(text)) found.add(u);
      // 新しいURLが1件も無いページに来たら終端とみなす。
      if (found.size === before) break;
    } catch (e) {
      warn(`[enrich] カテゴリ一覧の取得に失敗: ${url} (${String(e)})`);
      break;
    }
  }
  return sortArticleUrls(Array.from(found));
}

function sortArticleUrls(urls: string[]): string[] {
  return Array.from(new Set(urls)).sort((a, b) =>
    (articleNumberFromUrl(a) ?? a).localeCompare(articleNumberFromUrl(b) ?? b),
  );
}

/**
 * 全IPO記事URLを収集する（重複排除・記事番号昇順）。
 * サイトマップで1件も取れなければカテゴリ一覧にフォールバックする。
 * サイトマップ経由で取れた場合も、カテゴリ一覧の1ページ目（最新10件）だけは補助的に
 * 追加で読む（サイトマップの更新遅れで最新の上場予定銘柄を取りこぼさないため）。
 */
export async function collectAllIpoArticleUrls(
  options: CollectOptions = {},
): Promise<string[]> {
  const fetchText = options.fetchText ?? politeFetchText;
  const wait = options.sleep ?? sleep;
  const warn = options.warn ?? console.warn;

  const found = new Set<string>();
  let postSitemaps: string[] = [];
  try {
    postSitemaps = await fetchSitemapIndex(fetchText);
  } catch (e) {
    warn(`[enrich] サイトマップインデックスの取得に失敗 (${String(e)})`);
  }

  for (const url of postSitemaps) {
    await wait(REQUEST_INTERVAL_MS);
    try {
      const { text } = await fetchText(url);
      for (const u of extractIpoArticleUrls(text)) found.add(u);
    } catch (e) {
      warn(`[enrich] サイトマップの取得に失敗: ${url} (${String(e)})`);
    }
  }

  await wait(REQUEST_INTERVAL_MS);
  if (found.size === 0) {
    warn("[enrich] サイトマップから記事URLが取れないためカテゴリ一覧で代替します");
    for (const u of await collectFromCategory(options)) found.add(u);
  } else {
    for (const u of await collectFromCategory(options, 1)) found.add(u);
  }

  return sortArticleUrls(Array.from(found));
}
