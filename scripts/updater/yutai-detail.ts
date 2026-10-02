import { HTTP_TIMEOUT_MS, USER_AGENT } from "./config";
import { decodeHtmlEntities } from "./yutai";
import type { YutaiStatus } from "../../src/lib/yutai/types";

// 大和IR 株主優待ガイドの銘柄詳細ページ（/stock/detail/<code>）のパース。純関数と取得。
// ページの構造（2026-10 時点）:
//   - <div class="title_list"> の <li><span>業種</span><span>サービス業</span></li>
//   - <div class="product_info"> … <div class="single_price"> の手前までが優待内容（本文と「※」の注記）
//   - <hr id="anc05"> 以降が適時開示（TDnet）の見出し一覧
// 廃止・変更の注記は専用の欄が無いため、優待内容の本文と、「優待」を含む適時開示の見出しから拾う。

export interface YutaiDetail {
  /** 東証 33 業種名 */
  sector: string | null;
  status: YutaiStatus;
  /** 注記（40 字まで）。無ければ null */
  note: string | null;
  /** 優待の開始年（西暦）。取れなければ null */
  since: number | null;
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t　]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** 優待内容の本文で「変更」と書いてあっても優待の変更ではない定型句（交換先・贈呈時期など）。 */
const BOILERPLATE = /(毎年変更|年によって?変更|変更の可能性|変更になる?可能性|今後変更|変更する(?:場合|ことが)|変更させていただく|変更となる場合|変更される場合)[^\n。]*/g;

const ABOLISH = /廃止|終了(?:する|いたし|となり)|取りやめ|取り止め|休止|打ち切/;
const CHANGE = /変更|拡充|縮小|新設|改定|見直し|新たに導入|導入し|制度導入|優待新設|改悪|減額|増額|拡大|一部廃止/;

function snippet(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  // 一致の前の文頭（。／改行／※）から 40 字まで
  const head = text.slice(0, m.index);
  const start = Math.max(head.lastIndexOf("。"), head.lastIndexOf("\n"), head.lastIndexOf("※"), -1) + 1;
  const s = text.slice(start, m.index + m[0].length + 40).replace(/\s+/g, " ").trim();
  return s.length > 40 ? s.slice(0, 40) : s;
}

/** 銘柄詳細ページの HTML から業種・優待の状態・開始年を取る。 */
export function parseYutaiDetail(html: string): YutaiDetail {
  const sectorM = html.match(/<li><span>業種<\/span><span>([^<]*)<\/span><\/li>/);
  const sector = sectorM ? decodeHtmlEntities(sectorM[1]).trim() || null : null;

  const i = html.indexOf('class="product_info"');
  const j = html.indexOf('class="single_price"');
  const product = i >= 0 ? stripTags(html.slice(i, j > i ? j : i + 6000)).replace(BOILERPLATE, "") : "";

  // 適時開示（TDnet）の見出しのうち「優待」を含むもの
  const k = html.indexOf('id="anc05"');
  const tdnetHtml = k >= 0 ? html.slice(k) : "";
  const tdnetEnd = tdnetHtml.search(/TD-COM|株主優待積極企業|page top/);
  const titles = stripTags(tdnetEnd > 0 ? tdnetHtml.slice(0, tdnetEnd) : tdnetHtml.slice(0, 6000))
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.includes("優待"));

  const sources = [product, ...titles];
  let status: YutaiStatus = "active";
  let note: string | null = null;
  for (const src of sources) {
    const a = snippet(src, ABOLISH);
    if (a && /優待|制度/.test(a)) {
      status = "abolished";
      note = a;
      break;
    }
  }
  if (status === "active") {
    for (const src of sources) {
      const c = snippet(src, CHANGE);
      if (c && (src === product ? /優待|制度/.test(c) : true)) {
        status = "changed";
        note = c;
        break;
      }
    }
  }

  // 開始年: 「2019年…優待制度を導入／開始」のような記述
  let since: number | null = null;
  const sm = product.match(/(\d{4})年(?:\d{1,2}月)?[^。\n]{0,12}(?:優待(?:制度)?を?(?:導入|開始|新設|創設)|導入|開始)/);
  if (sm) {
    const y = Number(sm[1]);
    if (y >= 1980 && y <= 2100) since = y;
  }

  return { sector, status, note, since };
}

/** 詳細ページを 1 枚取る。 */
export async function fetchYutaiDetail(detailUrl: string): Promise<YutaiDetail> {
  const res = await fetch(detailUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseYutaiDetail(await res.text());
}
