import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type {
  CompanyProfile,
  FinancialPeriod,
  IpoEnriched,
  MajorShareholder,
  UnderwriterAllocation,
} from "../../src/types/enriched";

// 96ut（kabu.96ut.com）IPO記事1件のパーサ。純関数（ネットワーク・現在時刻に依存しない）。
// 壊れる前提で作る: ラベル表記揺れは候補配列＋正規化で吸収し、フィールド単位で失敗を握りつぶす。
// 他サイトの主観評価（初値予想・直前予想・BB参加姿勢）は一切取り込まない。

// ---------------------------------------------------------------------------
// 文字列ユーティリティ
// ---------------------------------------------------------------------------

/** 全角英数・全角記号を半角へ（NFKC）。全角チルダ「～」も "~" になる。 */
const nfkc = (s: string) => s.normalize("NFKC");

/** 連続空白を1つにして前後を削る。 */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** "-" / "未発表" / "未定" / "未決定" / 空 など「値なし」表記か。 */
function isBlankValue(text: string): boolean {
  const t = squash(nfkc(text));
  return (
    t === "" ||
    /^[-‐－ー―—–]+$/.test(t) ||
    /^(未発表|未定|未決定|未公表|未確定|なし|まだ更新していません)/.test(t)
  );
}

/** 文字列中の最初の数値（カンマ区切り・符号・小数対応）。無ければ null。 */
function firstNumber(text: string): number | null {
  const m = nfkc(text).match(/[-−]?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/[,]/g, "").replace("−", "-"));
  return Number.isFinite(n) ? n : null;
}

/** "85.0%" 等の最初のパーセント値。 */
function firstPercent(text: string): number | null {
  const m = nfkc(text).match(/([-−]?\d[\d,]*(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "").replace("−", "-"));
  return Number.isFinite(n) ? n : null;
}

/** "52.2億円" / "129億円" / "1.2兆円" / "500百万円" → 億円。取れなければ null。 */
function parseOku(text: string): number | null {
  if (isBlankValue(text)) return null;
  const t = nfkc(text);
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(兆|億|百万)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (m[2] === "兆") return round(n * 10000, 2);
  if (m[2] === "百万") return round(n / 100, 2);
  return n;
}

/** "2024/07/01 (月)" / "2024年7月1日" → "2024-07-01"。取れなければ null。 */
function parseDateText(text: string): string | null {
  const m = nfkc(text).match(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 最初の数値（整数株数など）。値なし表記なら null。 */
function parseCount(text: string): number | null {
  if (isBlankValue(text)) return null;
  return firstNumber(text);
}

// ---------------------------------------------------------------------------
// ラベル
// ---------------------------------------------------------------------------

/**
 * ラベル文字列を正規化する。NFKC（全角英数・全角括弧→半角）、空白・中点・ピリオド除去、
 * 件数表記 "(55)" の除去。例: "ＢＢ期間" → "BB期間"、"既存株主総計(55)" → "既存株主総計"、
 * "O.A.分" → "OA分"。
 */
export function normalizeLabel(label: string): string {
  return nfkc(label)
    .replace(/[【［[]/g, "(")
    .replace(/[】］\]]/g, ")")
    .replace(/\(\d+\)/g, "")
    .replace(/[\s.・･]/g, "")
    .trim();
}

/** 既知ラベルの表記揺れ候補。比較は normalizeLabel 後の完全一致。 */
export const LABEL_CANDIDATES = {
  priceRangeDecisionDate: ["仮条件決定日", "仮条件決定", "仮条件発表日"],
  bbPeriod: ["ＢＢ期間", "BB期間", "ブックビルディング期間", "需要申告期間"],
  allotmentDate: [
    "公募価格決定",
    "公募価格決定日",
    "公開価格決定",
    "公開価格決定日",
    "価格決定日",
    "抽選日",
  ],
  purchasePeriod: ["購入申込期間", "購入期間", "申込期間", "購入申込受付期間"],
  offeringShares: ["公募株式数", "公開株式数", "公募売出株式数", "公募・売出株式数"],
  overAllotment: ["O.A.分", "OA分", "オーバーアロットメント", "オーバーアロットメント分"],
  issuedShares: ["発行済株数", "発行済株式数", "上場時発行済株式数"],
  offeringRatio: ["OR", "オファリング・レシオ", "オファリングレシオ"],
  assumedPrice: ["想定価格", "想定発行価格", "想定売出価格"],
  priceRange: ["仮条件価格", "仮条件", "仮条件(円)"],
  offeringPrice: ["公募価格", "公開価格", "公募・売出価格", "発行価格"],
  absorption: ["吸収金額"],
  marketCap: ["時価総額"],
  leadUnderwriter: ["主幹事証券", "主幹事", "主幹事証券会社"],
  address: ["所在地", "本社所在地", "本店所在地"],
  established: ["設立", "設立年月日", "設立日"],
  employeeCount: ["従業員数", "従業員"],
  auditor: ["監査法人", "監査人"],
  existingShareholders: ["既存株主総計", "既存株主合計"],
  vcHolding: ["VC推定保有(内ロックアップ)", "VC推定保有", "VC保有"],
  stockOption: ["SO総計", "ストックオプション総計", "新株予約権総計"],
} as const;

type LabelKey = keyof typeof LABEL_CANDIDATES;

/** 構造変更検知に使う主要3ラベル（BB期間・公募価格・主幹事証券 相当）。 */
const KEY_LABEL_GROUPS: LabelKey[] = ["bbPeriod", "offeringPrice", "leadUnderwriter"];

/**
 * 「構造変更検知」: 主要3ラベル（ＢＢ期間・公募価格・主幹事証券 相当）すべてが見つからない場合
 * true（ページ構造が変わった可能性が高い）。labelsFound は生ラベル・正規化済みどちらでもよい。
 */
export function detectStructureChange(labelsFound: Set<string>): boolean {
  const normalized = new Set(Array.from(labelsFound, (l) => normalizeLabel(l)));
  return KEY_LABEL_GROUPS.every(
    (key) => !LABEL_CANDIDATES[key].some((c) => normalized.has(normalizeLabel(c))),
  );
}

// ---------------------------------------------------------------------------
// 生フィールド抽出
// ---------------------------------------------------------------------------

function loadHtml(html: string): CheerioAPI {
  const $ = cheerio.load(html);
  // <br> で区切られたセル内の値（"4,831,502<br>-26.9%"）がくっつかないよう空白に置換。
  $("br").replaceWith(" ");
  return $;
}

/** table 要素の「自分の」行だけを返す（入れ子テーブルの行は含めない）。 */
function ownRows($: CheerioAPI, table: Element): Element[] {
  return $(table)
    .find("tr")
    .toArray()
    .filter((tr) => $(tr).closest("table")[0] === table);
}

function cellText($: CheerioAPI, el: Element): string {
  return squash($(el).text());
}

function extractRawFieldsFrom($: CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $("table").each((_, table) => {
    for (const tr of ownRows($, table)) {
      const cells = $(tr).children("th, td").toArray();
      if (cells.length < 2) continue;
      const first = cells[0];
      if (first.tagName !== "th") continue;
      const tds = cells.slice(1).filter((c) => c.tagName === "td");
      if (tds.length === 0) continue;
      const label = cellText($, first);
      if (label === "" || label in fields) continue;
      fields[label] = tds.map((td) => cellText($, td)).join("\t");
    }
  });
  return fields;
}

/**
 * 記事HTMLからテーブル行（先頭セルが th、続くセルに td がある行）を「ラベル → 値」で抽出する。
 * 値は td が複数あればタブ区切りで連結。同じラベルは最初の出現を採用する。
 */
export function extractRawFields(html: string): Record<string, string> {
  return extractRawFieldsFrom(loadHtml(html));
}

/** 正規化ラベルで引けるルックアップ。 */
function buildLookup(raw: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [label, value] of Object.entries(raw)) {
    const key = normalizeLabel(label);
    if (!map.has(key)) map.set(key, value);
  }
  return {
    labels: new Set(map.keys()),
    get(key: LabelKey): string | undefined {
      for (const c of LABEL_CANDIDATES[key]) {
        const v = map.get(normalizeLabel(c));
        if (v !== undefined) return v;
      }
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// 個別パーサ（export はテスト対象）
// ---------------------------------------------------------------------------

/**
 * 記事タイトル「<社名>(<コード>)のIPO新規上場情報」からコードを抽出。取れなければ null。
 * コードは数字4桁、または数字3桁＋英字1桁（例: 648A）。全角も可。社名内の括弧は無視する。
 */
export function extractCodeFromTitle(title: string): string | null {
  const t = nfkc(title).toUpperCase();
  const matches = Array.from(t.matchAll(/\(\s*(\d{3}[0-9A-Z])\s*\)/g));
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

/**
 * "1,200円～1,400円" / "2,850～2,900円 (変動率…)" 等の仮条件レンジをパース。
 * "未発表" / "未定" / "-" は null。全角チルダ・波ダッシュ・半角チルダ対応。単一価格は low=high。
 */
export function parsePriceRangeText(
  text: string,
): { low: number; high: number } | null {
  if (isBlankValue(text)) return null;
  // 変動率などの補足（括弧以降）は読まない。
  const main = nfkc(text).split(/[(（]/)[0];
  const range = main.match(
    /(\d[\d,]*(?:\.\d+)?)\s*円?\s*[~〜～]\s*(\d[\d,]*(?:\.\d+)?)/,
  );
  if (range) {
    const a = Number(range[1].replace(/,/g, ""));
    const b = Number(range[2].replace(/,/g, ""));
    if (a > 0 && b > 0) return { low: Math.min(a, b), high: Math.max(a, b) };
    return null;
  }
  const single = firstNumber(main);
  return single !== null && single > 0 ? { low: single, high: single } : null;
}

/** "開始: 2026/09/29 (火) ～ 終了: 2026/10/02 (金)" 形式から期間を抽出。2日付に満たなければ null。 */
export function parseBbPeriodText(
  text: string,
): { start: string; end: string } | null {
  const t = nfkc(text);
  const dates = Array.from(
    t.matchAll(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/g),
  ).map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  if (dates.length < 2) return null;
  return { start: dates[0], end: dates[1] };
}

/** 見出し行（th）に指定語を含む列の位置を返す。 */
function findHeaderIndex(headers: string[], ...keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.includes(k)));
}

/** 見出し行に keywords をすべて含むテーブルを探し、[table, 見出し, データ行] を返す。 */
function findTableByHeader(
  $: CheerioAPI,
  keywords: string[],
): { headers: string[]; rows: Element[] } | null {
  for (const table of $("table").toArray()) {
    const rows = ownRows($, table);
    const headerIdx = rows.findIndex((tr) => {
      const ths = $(tr).children("th").toArray();
      if (ths.length < 2) return false;
      const labels = ths.map((th) => normalizeLabel($(th).text()));
      return keywords.every((k) => labels.some((l) => l.includes(normalizeLabel(k))));
    });
    if (headerIdx < 0) continue;
    const headers = $(rows[headerIdx])
      .children("th, td")
      .toArray()
      .map((c) => normalizeLabel($(c).text()));
    return { headers, rows: rows.slice(headerIdx + 1) };
  }
  return null;
}

function parseUnderwriterAllocationsFrom($: CheerioAPI): UnderwriterAllocation[] {
  const found = findTableByHeader($, ["証券会社名", "割当"]);
  if (!found) return [];
  const { headers, rows } = found;
  const nameIdx = Math.max(0, findHeaderIndex(headers, "証券会社"));
  const sharesIdx = headers.findIndex((h) => h.includes("割当") && !h.includes("%"));
  const ratioIdx = headers.findIndex((h) => h.includes("%"));
  const seen = new Set<string>();
  const result: UnderwriterAllocation[] = [];
  for (const tr of rows) {
    const cells = $(tr).children("td").toArray();
    if (cells.length < 2) continue;
    const name = cellText($, cells[nameIdx]);
    if (name === "" || /^[(（]?その他/.test(name) || seen.has(name)) continue;
    seen.add(name);
    const sharesText = sharesIdx >= 0 && cells[sharesIdx] ? cellText($, cells[sharesIdx]) : "";
    const ratioText = ratioIdx >= 0 && cells[ratioIdx] ? cellText($, cells[ratioIdx]) : "";
    result.push({
      name,
      shares: parseCount(sharesText),
      ratioPercent: isBlankValue(ratioText) ? null : firstNumber(ratioText),
    });
  }
  return result;
}

/** 幹事団テーブル（証券会社名・割当数・割当(%)）をパース。「割当数」「割当(%)」が "-" なら null。 */
export function parseUnderwriterAllocations(html: string): UnderwriterAllocation[] {
  return parseUnderwriterAllocationsFrom(loadHtml(html));
}

interface ShareholderTable {
  shareholders: MajorShareholder[];
  /** ロックアップ列に「1.5倍」等の価格解除条項が書かれていたか。 */
  hasPriceReleaseMark: boolean;
}

function parseShareholderTable($: CheerioAPI): ShareholderTable {
  const found = findTableByHeader($, ["氏名", "株数", "ロックアップ"]);
  if (!found) return { shareholders: [], hasPriceReleaseMark: false };
  const { headers, rows } = found;
  const nameIdx = Math.max(0, findHeaderIndex(headers, "氏名"));
  const sharesIdx = findHeaderIndex(headers, "株数");
  const ratioIdx = findHeaderIndex(headers, "割合");
  const lockIdx = findHeaderIndex(headers, "ロックアップ");
  const shareholders: MajorShareholder[] = [];
  let hasPriceReleaseMark = false;
  for (const tr of rows) {
    const cells = $(tr).children("th, td").toArray();
    // 総計行（先頭が th）は大株主ではない。
    if (cells.length < 3 || cells[0].tagName !== "td") continue;
    const name = cellText($, cells[nameIdx]);
    // "240,000(77,500:32.3%)" の括弧内は売出株数なので読まない。
    const sharesText = sharesIdx >= 0 ? cellText($, cells[sharesIdx]).split(/[(（]/)[0] : "";
    const shares = firstNumber(sharesText);
    const ratio = ratioIdx >= 0 ? firstNumber(cellText($, cells[ratioIdx])) : null;
    const lockText = lockIdx >= 0 && cells[lockIdx] ? nfkc(cellText($, cells[lockIdx])) : "";
    const days = lockText.match(/(\d+)\s*日/);
    if (/\d(?:\.\d+)?\s*倍/.test(lockText)) hasPriceReleaseMark = true;
    if (name === "" || shares === null || ratio === null) continue;
    shareholders.push({
      name,
      shares,
      ratioPercent: ratio,
      lockupDays: days ? Number(days[1]) : null,
    });
  }
  return { shareholders, hasPriceReleaseMark };
}

/** 大株主テーブル（氏名・株数・割合・ロックアップ日数）をパース。 */
export function parseMajorShareholders(html: string): MajorShareholder[] {
  return parseShareholderTable(loadHtml(html)).shareholders;
}

/**
 * 96utの千円/百万円混在表記を桁数から自動判定して百万円に正規化する純関数。
 * 値（絶対値）が10万未満なら百万円単位とみなしそのまま、10万以上なら千円とみなし1000で割る。
 */
export function normalizeToMillionYen(value: number): number {
  return Math.abs(value) < 100_000 ? value : value / 1000;
}

// ---------------------------------------------------------------------------
// 業績テーブル
// ---------------------------------------------------------------------------

interface RawFinancialRow {
  /** "2023/07" */
  ym: string;
  period: string;
  revenue: number | null;
  revenueChange: number | null;
  ordinary: number | null;
  net: number | null;
  netAssets: number | null;
  totalAssets: number | null;
  /** 純資産・総資産が 0/空 の行は業績予想（決算前）とみなす。 */
  forecast: boolean;
}

/** "3,531,535 -26.9%" → 値と変化率。 */
function splitValueAndChange(text: string): { value: number | null; change: number | null } {
  const tokens = nfkc(text).split(/\s+/).filter((t) => t !== "");
  const valueToken = tokens.find((t) => !t.includes("%"));
  const changeToken = tokens.find((t) => t.includes("%"));
  return {
    value: valueToken && !isBlankValue(valueToken) ? firstNumber(valueToken) : null,
    change: changeToken ? firstPercent(changeToken) : null,
  };
}

function parseFinancialRows($: CheerioAPI): RawFinancialRow[] {
  const found = findTableByHeader($, ["決算期", "売上"]);
  if (!found) return [];
  const { headers, rows } = found;
  const revIdx = findHeaderIndex(headers, "売上");
  const ordIdx = findHeaderIndex(headers, "経常", "営業");
  const netIdx = findHeaderIndex(headers, "当期", "純利益");
  const assetIdx = findHeaderIndex(headers, "純資産", "総資産");
  const result: RawFinancialRow[] = [];
  for (const tr of rows) {
    const cells = $(tr).children("td").toArray();
    if (cells.length < 2) continue;
    const periodText = nfkc(cellText($, cells[0]));
    const ym = periodText.match(/(\d{4})\s*[/年]\s*(\d{1,2})/);
    if (!ym) continue;
    const get = (i: number) => (i >= 0 && cells[i] ? cellText($, cells[i]) : "");
    const rev = splitValueAndChange(get(revIdx));
    const ord = splitValueAndChange(get(ordIdx));
    const net = splitValueAndChange(get(netIdx));
    const assets = nfkc(get(assetIdx))
      .split(/\s+/)
      .filter((t) => t !== "")
      .map((t) => firstNumber(t));
    const netAssets = assets[0] ?? null;
    const totalAssets = assets[1] ?? null;
    const forecast = !netAssets && !totalAssets;
    result.push({
      ym: `${ym[1]}/${ym[2].padStart(2, "0")}`,
      period: `${ym[1]}年${Number(ym[2])}月期${forecast ? "（予想）" : ""}`,
      revenue: rev.value,
      revenueChange: rev.change,
      ordinary: ord.value,
      net: net.value,
      netAssets,
      totalAssets,
      forecast,
    });
  }
  return result;
}

/**
 * 業績テーブルが千円単位かを判定する。総資産と時価総額（億円）が取れていれば、
 * 「千円とみなした総資産 ÷ 時価総額」が 0.3% 未満（=ありえない小ささ）のときだけ百万円単位と判断する
 * （大型IPOの百万円表記を千円と誤判定しないため）。取れなければ normalizeToMillionYen の桁判定。
 */
function isThousandYenTable(rows: RawFinancialRow[], marketCapOku: number | undefined): boolean {
  const actual = rows.filter((r) => !r.forecast);
  const latestAssets = [...actual].reverse().find((r) => r.totalAssets && r.totalAssets > 0);
  if (latestAssets?.totalAssets && marketCapOku && marketCapOku > 0) {
    const assetsIfThousand = latestAssets.totalAssets / 1000; // 百万円
    const marketCapMillion = marketCapOku * 100;
    return assetsIfThousand / marketCapMillion >= 0.003;
  }
  const values = rows.flatMap((r) => [r.revenue, r.ordinary, r.net]).filter(
    (v): v is number => v !== null,
  );
  if (values.length === 0) return true;
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)));
  return normalizeToMillionYen(maxAbs) !== maxAbs;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/** 価格マトリックス（想定・公開・初値 の列）から指定行を読む。 */
function parseMatrixRow(
  $: CheerioAPI,
  lookup: ReturnType<typeof buildLookup>,
  key: "absorption" | "marketCap",
): { assumed: number | null; offering: number | null; initial: number | null } {
  const found = findTableByHeader($, ["想定価格", "公開価格"]);
  if (found) {
    const { headers, rows } = found;
    const idx = {
      assumed: findHeaderIndex(headers, "想定"),
      offering: findHeaderIndex(headers, "公開", "公募"),
      initial: findHeaderIndex(headers, "初値"),
    };
    for (const tr of rows) {
      const cells = $(tr).children("th, td").toArray();
      if (cells.length < 2) continue;
      const label = normalizeLabel($(cells[0]).text());
      if (!LABEL_CANDIDATES[key].some((c) => normalizeLabel(c) === label)) continue;
      const at = (i: number) => (i >= 0 && cells[i] ? parseOku(cellText($, cells[i])) : null);
      return { assumed: at(idx.assumed), offering: at(idx.offering), initial: at(idx.initial) };
    }
  }
  // マトリックスが見つからなければ生フィールドを「想定・公開・初値」の列順とみなす。
  const raw = lookup.get(key);
  if (raw === undefined) return { assumed: null, offering: null, initial: null };
  const cols = raw.split("\t").map((c) => parseOku(c));
  if (cols.length === 1) return { assumed: null, offering: cols[0], initial: null };
  return { assumed: cols[0] ?? null, offering: cols[1] ?? null, initial: cols[2] ?? null };
}

/**
 * 主幹事証券の欄を読む。共同主幹事は <div> や <a> で1社ずつ並ぶため要素単位で取り出す。
 * 要素が無ければ「、」「／」区切りのテキストとして扱う。
 */
function parseLeadUnderwriters($: CheerioAPI): string[] {
  const candidates = new Set(LABEL_CANDIDATES.leadUnderwriter.map((c) => normalizeLabel(c)));
  for (const th of $("th").toArray()) {
    if (!candidates.has(normalizeLabel($(th).text()))) continue;
    const td = $(th).nextAll("td").first();
    if (td.length === 0) continue;
    const blocks = td.find("a, div, li").toArray()
      .filter((el) => $(el).find("a, div, li").length === 0)
      .map((el) => squash($(el).text()))
      .filter((t) => t !== "");
    const names = blocks.length > 0 ? blocks : squash(td.text()).split(/[、,／/]/).map(squash);
    const result = Array.from(new Set(names.filter((n) => n !== "" && !isBlankValue(n))));
    if (result.length > 0) return result;
  }
  return [];
}

/** 本文・ロックアップ欄から「1.5倍で解除」等の価格解除条項の記載を探す（「解除なし」は除外）。 */
function hasPriceReleaseClause(bodyText: string): boolean {
  const t = nfkc(bodyText);
  if (/\d+\s*日\s*(?:or|OR|または|もしくは|\/|or)\s*\d(?:\.\d+)?\s*倍/.test(t)) return true;
  const re = /\d(?:\.\d+)?\s*倍(?:以上)?(?:で|にて|に達した場合|到達で|の)?(?:ロックアップ)?(?:価格)?解除(?!なし|無し|条項なし|はなし)/;
  return re.test(t);
}

/** 最頻値（同数なら大きい方）。空なら null。 */
function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== null && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** フィールド単位の try/catch。失敗は undefined 扱いで先へ進む。 */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // 寛容パース: 1フィールドの失敗で記事全体を捨てない。
  }
}

export interface ParseDiagnostics {
  /** 見つかったラベル（正規化済み）。 */
  labelsFound: Set<string>;
  /** detectStructureChange の結果。 */
  structureChanged: boolean;
}

/**
 * parse96utArticle の詳細版。診断情報（構造変更検知）も返す。
 * code を抽出できなければ record は null。
 */
export function parse96utArticleWithDiagnostics(
  html: string,
  articleUrl: string,
  fetchedAtIso: string,
): { record: IpoEnriched | null; diagnostics: ParseDiagnostics } {
  const $ = loadHtml(html);
  const raw = extractRawFieldsFrom($);
  const lookup = buildLookup(raw);
  const structureChanged = detectStructureChange(lookup.labels);
  const diagnostics = { labelsFound: lookup.labels, structureChanged };

  const title = squash($("h1").first().text()) || squash($("title").first().text());
  const code = extractCodeFromTitle(title);
  if (!code) return { record: null, diagnostics };

  const rec: IpoEnriched = { code, articleUrl, fetchedAt: fetchedAtIso, sources: {} };
  const source = { url: articleUrl, fetchedAt: fetchedAtIso };
  const set = <K extends keyof IpoEnriched>(field: K, value: IpoEnriched[K] | null | undefined) => {
    if (value === undefined || value === null) return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    rec[field] = value as IpoEnriched[K];
    rec.sources[field as string] = { ...source };
  };
  const text = (key: LabelKey) => lookup.get(key);

  // --- 日程 ---
  attempt(() => {
    const v = text("priceRangeDecisionDate");
    if (v !== undefined) set("priceRangeDecisionDate", parseDateText(v));
  });
  attempt(() => {
    const v = text("bbPeriod");
    if (v !== undefined) set("bbPeriod", parseBbPeriodText(v));
  });
  attempt(() => {
    const v = text("allotmentDate");
    if (v !== undefined) set("allotmentDate", parseDateText(v));
  });
  attempt(() => {
    const v = text("purchasePeriod");
    if (v !== undefined) set("purchasePeriod", parseBbPeriodText(v));
  });

  // --- 株数・比率 ---
  attempt(() => {
    const v = text("offeringShares");
    if (v === undefined) return;
    const t = nfkc(v);
    const pub = t.match(/公募\s*:?\s*(\d[\d,]*)\s*株/);
    const sale = t.match(/売出\s*:?\s*(\d[\d,]*)\s*株/);
    if (pub) set("publicShares", Number(pub[1].replace(/,/g, "")));
    if (sale) set("saleShares", Number(sale[1].replace(/,/g, "")));
    // 内訳が無く総数だけの記載は公募とみなさない（誤帰属を避ける）。
  });
  attempt(() => {
    const v = text("overAllotment");
    if (v !== undefined) set("overAllotment", parseCount(v));
  });
  attempt(() => {
    const v = text("issuedShares");
    if (v !== undefined) set("issuedShares", parseCount(v));
  });
  attempt(() => {
    const v = text("offeringRatio");
    if (v !== undefined && !isBlankValue(v)) set("offeringRatio", firstPercent(v) ?? firstNumber(v));
  });

  // --- 価格 ---
  attempt(() => {
    const v = text("assumedPrice");
    if (v !== undefined) set("assumedPrice", parseCount(v.split(/[(（]/)[0]));
  });
  attempt(() => {
    const v = text("priceRange");
    if (v !== undefined) set("priceRange", parsePriceRangeText(v) ?? undefined);
  });
  attempt(() => {
    const v = text("offeringPrice");
    if (v === undefined) return;
    if (isBlankValue(v)) {
      // 未決定: 値は null、出典は付けない（取得できた値ではないため）。
      rec.offeringPrice = null;
      return;
    }
    set("offeringPrice", parseCount(v.split(/[(（]/)[0]));
  });

  // --- 吸収金額・時価総額 ---
  attempt(() => {
    const abs = parseMatrixRow($, lookup, "absorption");
    set("absorptionAmount", abs.offering);
    set("absorptionAmountAssumed", abs.assumed);
    set("absorptionAmountInitial", abs.initial);
  });
  attempt(() => {
    const cap = parseMatrixRow($, lookup, "marketCap");
    // 公開価格ベースを優先し、未決定なら想定価格ベース。
    set("marketCap", cap.offering ?? cap.assumed);
  });

  // --- 幹事 ---
  let leadNames: string[] = [];
  attempt(() => {
    leadNames = parseLeadUnderwriters($);
    // 共同主幹事は base の表記（"A・B"）に合わせて中点で連結する。
    if (leadNames.length > 0) set("leadUnderwriter", leadNames.join("・"));
  });
  attempt(() => {
    const allocations = parseUnderwriterAllocationsFrom($);
    if (allocations.length > 0) set("underwriterAllocations", allocations);
    const names = [...leadNames, ...allocations.map((a) => a.name)];
    if (names.length > 0) set("underwriters", Array.from(new Set(names)));
  });

  // --- 会社概要 ---
  attempt(() => {
    const pick = (key: LabelKey) => {
      const v = text(key);
      return v === undefined || isBlankValue(v) ? null : squash(v);
    };
    const employees = pick("employeeCount");
    const profile: CompanyProfile = {
      address: pick("address"),
      established: pick("established"),
      employeeCount: employees === null ? null : firstNumber(employees),
      auditor: pick("auditor"),
    };
    if (Object.values(profile).some((v) => v !== null)) set("companyProfile", profile);
  });

  // --- 業績 ---
  attempt(() => {
    const rows = parseFinancialRows($);
    if (rows.length === 0) return;
    const thousand = isThousandYenTable(rows, rec.marketCap);
    const toMillion = (v: number | null) =>
      v === null ? null : round(thousand ? v / 1000 : v, 1);
    const history: FinancialPeriod[] = rows.map((r) => ({
      period: r.period,
      revenue: toMillion(r.revenue),
      operatingProfit: toMillion(r.ordinary),
      netProfit: toMillion(r.net),
      revenueChangePercent: r.revenueChange,
    }));
    set("financialHistory", history);

    // 最新の実績期（予想行を除く）で financials を作る。
    const actualIdx = rows.map((r, i) => (r.forecast || r.revenue === null ? -1 : i)).filter((i) => i >= 0);
    const latestIdx = actualIdx[actualIdx.length - 1];
    if (latestIdx === undefined) return;
    const latest = history[latestIdx];
    let growth = latest.revenueChangePercent;
    if (growth === null && latestIdx > 0) {
      const prev = history[latestIdx - 1].revenue;
      if (prev && latest.revenue !== null) {
        growth = round(((latest.revenue - prev) / Math.abs(prev)) * 100, 1);
      }
    }
    if (growth === null || latest.revenue === null) return;
    const profit = latest.operatingProfit ?? latest.netProfit ?? 0;
    set("financials", {
      revenue: latest.revenue,
      revenueGrowth: growth,
      operatingProfit: profit,
      isProfitable: profit > 0,
    });
  });

  // --- 1株指標（EPS・BPS・配当）: 最新の実績期に合わせる ---
  attempt(() => {
    const found = findTableByHeader($, ["決算期", "EPS"]);
    if (!found) return;
    const { headers, rows } = found;
    const epsIdx = findHeaderIndex(headers, "EPS");
    const bpsIdx = findHeaderIndex(headers, "BPS");
    const divIdx = findHeaderIndex(headers, "配当");
    const finRows = parseFinancialRows($);
    const latestActual = [...finRows].reverse().find((r) => !r.forecast);
    const parsed = rows
      .map((tr) => $(tr).children("td").toArray())
      .filter((cells) => cells.length >= 2)
      .map((cells) => {
        const ym = nfkc(cellText($, cells[0])).match(/(\d{4})\s*[/年]\s*(\d{1,2})/);
        const num = (i: number) =>
          i >= 0 && cells[i] && !isBlankValue(cellText($, cells[i])) ? firstNumber(cellText($, cells[i])) : null;
        return {
          ym: ym ? `${ym[1]}/${ym[2].padStart(2, "0")}` : "",
          eps: num(epsIdx),
          bps: num(bpsIdx),
          dividend: num(divIdx),
        };
      });
    if (parsed.length === 0) return;
    const row =
      (latestActual && parsed.find((p) => p.ym === latestActual.ym)) ?? parsed[parsed.length - 1];
    set("eps", row.eps);
    set("bps", row.bps);
    set("dividendPerShare", row.dividend);
  });

  // --- 株主・ロックアップ・VC・SO ---
  let hasPriceReleaseMark = false;
  attempt(() => {
    const table = parseShareholderTable($);
    hasPriceReleaseMark = table.hasPriceReleaseMark;
    if (table.shareholders.length > 0) set("majorShareholders", table.shareholders);
  });
  attempt(() => {
    const v = text("existingShareholders");
    if (v === undefined) return;
    const t = nfkc(v);
    const target = t.match(/対象\s*:?\s*(\d[\d,]*)\s*株/);
    const coverage = t.match(/カバー率\s*:?\s*(\d+(?:\.\d+)?)\s*%/);
    if (target) set("existingShareholderLockupShares", Number(target[1].replace(/,/g, "")));
    if (coverage) set("existingShareholderLockupCoverage", Number(coverage[1]));
  });
  attempt(() => {
    const days = mode(
      (rec.majorShareholders ?? [])
        .map((s) => s.lockupDays)
        .filter((d): d is number => d !== null && d > 0),
    );
    if (days === null) return;
    // サイドバー等の他銘柄の記述を拾わないよう、本文（article）を優先して走査する。
    const bodyText = $("article").first().text() || $("body").text();
    set("lockup", {
      days,
      hasPriceRelease: hasPriceReleaseMark || hasPriceReleaseClause(bodyText),
      coverage: rec.existingShareholderLockupCoverage ?? 0,
    });
  });
  attempt(() => {
    const v = text("vcHolding");
    if (v === undefined) return;
    const t = nfkc(v);
    const after = t.match(/売出後\s*:?\s*(\d[\d,]*)\s*株(?:\s*(\d[\d,]*)\s*株)?/);
    if (!after) return;
    const holding = Number(after[1].replace(/,/g, ""));
    set("vcHoldingShares", holding);
    if (after[2] !== undefined) set("vcLockupShares", Number(after[2].replace(/,/g, "")));
    if (rec.issuedShares && rec.issuedShares > 0) {
      set("vcRatio", round((holding / rec.issuedShares) * 100, 2));
    }
  });
  attempt(() => {
    const v = text("stockOption");
    if (v !== undefined) set("stockOptionShares", parseCount(v.split("\t")[0]));
  });

  return { record: rec, diagnostics };
}

/**
 * 記事HTML1件を IpoEnriched へ変換する。パースは寛容（フィールド単位でtry/catch、
 * 失敗したフィールドはundefinedのまま次へ進む）。code を抽出できなければ null を返す
 * （呼び出し側でスキップしログに残す）。取得できた全フィールドに sources[フィールド名] を設定する。
 * 構造変更（主要3ラベルすべて欠落）を検知したら console.warn を出す（例外は投げない）。
 */
export function parse96utArticle(
  html: string,
  articleUrl: string,
  fetchedAtIso: string,
): IpoEnriched | null {
  const { record, diagnostics } = parse96utArticleWithDiagnostics(html, articleUrl, fetchedAtIso);
  if (diagnostics.structureChanged) {
    console.warn(
      `[enrich] 構造変更の可能性: 主要ラベル（BB期間・公募価格・主幹事証券）が見つかりません ${articleUrl}`,
    );
  }
  return record;
}
