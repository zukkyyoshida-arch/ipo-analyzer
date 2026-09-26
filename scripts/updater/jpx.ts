import * as cheerio from "cheerio";
import type { Market } from "../../src/types/ipo";
import {
  JPX_NEW_LISTINGS_URL,
  HTTP_TIMEOUT_MS,
  USER_AGENT,
} from "./config";

// JPX「新規上場会社情報」ページの取得とパース。
// テーブルは1銘柄が2行構成:
//   行A(8セル): 上場日(承認日) / 会社名 / コード / 会社概要 / 確認書 / 仮条件 / 公募 / 売買単位
//   行B(6セル): 市場区分 / Iの部 / CG報告書 / 公募・売出価格 / 売出 / 決算短信
// ヘッダも同じ2行構成なので、コード列が銘柄コード形式の行ペアだけを採用する。

export interface JpxListing {
  code: string;
  name: string;
  /** YYYY-MM-DD */
  listingDate: string;
  market: Market | null;
  /** 仮条件レンジ（取得できた場合）。"-" のときは null。 */
  priceRange: { low: number; high: number } | null;
}

/** "2026/08/04 （2026/06/30）" → "2026-08-04" */
function parseListingDate(cell: string): string {
  const m = cell.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** 市場区分テキストを Market に正規化。判別不能なら null。 */
function parseMarket(cell: string): Market | null {
  const t = cell.replace(/\s/g, "");
  if (t.includes("グロース")) return "グロース";
  if (t.includes("スタンダード")) return "スタンダード";
  if (t.includes("プライム")) return "プライム";
  return null;
}

/** "620.0～680.0" 形式等から仮条件を抽出。"-" や解析不能は null。 */
function parsePriceRange(
  cell: string,
): { low: number; high: number } | null {
  const nums = cell.match(/[\d,]+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const values = nums
    .map((n) => Number(n.replace(/,/g, "")))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (values.length === 0) return null;
  if (values.length === 1) return { low: values[0], high: values[0] };
  return { low: Math.min(...values), high: Math.max(...values) };
}

/** 会社コード形式か（例: 323A / 1234 / 607A）。 */
function isStockCode(text: string): boolean {
  const t = text.trim();
  return /^\d{3,4}[A-Z0-9]$/.test(t) || /^\d{4}$/.test(t);
}

/**
 * JPX ページの HTML をパースして上場予定/新規銘柄一覧を返す。
 * パースは寛容: 想定外の行は読み飛ばし、取れる範囲のフィールドのみ埋める。
 */
export function parseJpxHtml(html: string): JpxListing[] {
  const $ = cheerio.load(html);
  const rows = $("table.widetable tr").toArray();

  const listings: JpxListing[] = [];

  for (let i = 0; i < rows.length; i++) {
    const cellsA = $(rows[i])
      .find("td, th")
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, " ").trim());

    // 行A の3列目がコード形式でなければ銘柄行ペアの先頭ではない。
    if (cellsA.length < 3 || !isStockCode(cellsA[2])) continue;

    const code = cellsA[2].trim();
    const listingDate = parseListingDate(cellsA[0] ?? "");
    const name = cleanName(cellsA[1] ?? "");
    const priceRange = parsePriceRange(cellsA[5] ?? "");

    // 次行（行B）から市場区分を取得。
    let market: Market | null = null;
    const rowB = rows[i + 1];
    if (rowB) {
      const cellsB = $(rowB)
        .find("td, th")
        .toArray()
        .map((el) => $(el).text().replace(/\s+/g, " ").trim());
      // 行B の先頭が市場区分。コード形式なら行Bではないので市場は空のまま。
      if (cellsB.length > 0 && !isStockCode(cellsB[0])) {
        market = parseMarket(cellsB[0]);
      }
    }

    listings.push({ code, name, listingDate, market, priceRange });
  }

  return listings;
}

/** "（株）エブリー" 等の法人格表記を軽く整形（先頭/末尾の（株）を除去）。
 * 会社名セルには「代表者インタビュー」等のリンクテキストが混入するため先に除去する。 */
function cleanName(raw: string): string {
  return raw
    .replace(/代表者インタビュー/g, "")
    .replace(/^（株）/, "")
    .replace(/（株）$/, "")
    .replace(/^\(株\)/, "")
    .trim();
}

/** JPX ページを1回だけ取得する（タイムアウト・UA明示）。 */
export async function fetchJpxHtml(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(JPX_NEW_LISTINGS_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`JPX fetch failed: HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 取得＋パースをまとめて実行。失敗時は例外を投げる（呼び出し側で握る）。 */
export async function fetchJpxListings(): Promise<JpxListing[]> {
  const html = await fetchJpxHtml();
  return parseJpxHtml(html);
}
