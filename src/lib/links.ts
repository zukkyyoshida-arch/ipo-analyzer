// 詳細ページの一次情報リンク（kabutan・JPX・EDINET・96ut 記事）の URL を組み立てる純関数。

export interface ExternalLink {
  id: "kabutan-stock" | "kabutan-disclosure" | "jpx-new-listing" | "edinet" | "96ut-article";
  label: string;
  /** 補足（リンク先の内容） */
  note: string;
  url: string;
}

export const JPX_NEW_LISTING_URL = "https://www.jpx.co.jp/listing/stocks/new/index.html";
export const EDINET_SEARCH_URL = "https://disclosure2.edinet-fsa.go.jp/";

/** 証券コードとして妥当か（4桁の数字、または英字を含む新形式の4文字。例: 7203・130A）。 */
export function isValidSecuritiesCode(code: string): boolean {
  return /^[0-9][0-9A-Z]{2}[0-9A-Z]$/.test(code.trim().toUpperCase());
}

/** kabutan の銘柄ページ URL。コードが不正なら null。 */
export function kabutanStockUrl(code: string): string | null {
  if (!isValidSecuritiesCode(code)) return null;
  return `https://kabutan.jp/stock/?code=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/** kabutan の適時開示一覧 URL。コードが不正なら null。 */
export function kabutanDisclosureUrl(code: string): string | null {
  if (!isValidSecuritiesCode(code)) return null;
  return `https://kabutan.jp/stock/news?code=${encodeURIComponent(code.trim().toUpperCase())}&b=k`;
}

/** http(s) の URL だけを通す（javascript: 等を弾く）。 */
function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 銘柄1件分の一次情報リンクを並べる。コード不正時は kabutan を省き、articleUrl が
 * 無い・不正なら 96ut 記事を省く。JPX・EDINET は銘柄によらず固定の検索入口。
 * @param code 証券コード
 * @param articleUrl 96ut 記事 URL（enriched.articleUrl。任意）
 */
export function buildExternalLinks(code: string, articleUrl?: string): ExternalLink[] {
  const links: ExternalLink[] = [];
  const stock = kabutanStockUrl(code);
  if (stock) {
    links.push({ id: "kabutan-stock", label: "株探 銘柄ページ", note: "株価・ニュース", url: stock });
  }
  const disclosure = kabutanDisclosureUrl(code);
  if (disclosure) {
    links.push({
      id: "kabutan-disclosure",
      label: "株探 適時開示",
      note: "決算・開示資料",
      url: disclosure,
    });
  }
  links.push({
    id: "jpx-new-listing",
    label: "JPX 新規上場会社情報",
    note: "取引所の上場会社概要",
    url: JPX_NEW_LISTING_URL,
  });
  links.push({
    id: "edinet",
    label: "EDINET 書類検索",
    note: "有価証券届出書など",
    url: EDINET_SEARCH_URL,
  });
  const article = safeHttpUrl(articleUrl);
  if (article) {
    links.push({ id: "96ut-article", label: "96ut 記事", note: "補完データの取得元", url: article });
  }
  return links;
}
