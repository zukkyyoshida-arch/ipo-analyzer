// 保有中リストの型と、localStorage から読んだ値の検証。純関数。
// 保存は端末の localStorage だけ（同期・サーバー保存はしない）。

/** 売買の戦略。優待なら権利確定月を持つ。 */
export type HoldingStrategy = "yutai" | "other";

export const HOLDING_STRATEGY_LABELS: Record<HoldingStrategy, string> = {
  yutai: "優待",
  other: "その他",
};

/** 売却の記録。 */
export interface HoldingSale {
  /** 売却価格（円/株） */
  price: number;
  /** 売却日（YYYY-MM-DD） */
  date: string;
}

/** 手入力の現在値。 */
export interface ManualPrice {
  price: number;
  /** 入力した日（YYYY-MM-DD） */
  date: string;
}

/** 保有 1 件。 */
export interface Holding {
  id: string;
  /** 証券コード（例 "3160" / "138A"） */
  code: string;
  name: string;
  /** 買値（円/株） */
  buyPrice: number;
  /** 株数 */
  shares: number;
  /** 買った日（YYYY-MM-DD）。分からなければ空 */
  buyDate: string;
  strategy: HoldingStrategy;
  /** 優待の権利確定月（1〜12）。優待でなければ null */
  rightsMonth: number | null;
  /** 決算日（手入力、YYYY-MM-DD）。無ければ null */
  earningsDate: string | null;
  memo: string;
  /** 手入力の現在値。無ければ null */
  manualPrice: ManualPrice | null;
  /** 売却済みなら記録。保有中は null */
  sold: HoldingSale | null;
}

/** 現在値の出どころ。 */
export type PriceSource = "live" | "manual" | "yutai";

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  live: "取得",
  manual: "手入力",
  yutai: "月足終値",
};

/** 現在値 1 件（いつ時点の値か付き）。 */
export interface PriceQuote {
  price: number;
  /** 何日時点の値か（YYYY-MM-DD） */
  asOf: string;
  source: PriceSource;
}

/** 取得した現在値の置き場（コード → 値）。 */
export type PriceCache = Record<string, PriceQuote>;

export const PORTFOLIO_STORAGE_KEY = "ipo-analyzer:portfolio:v1";
export const PRICE_CACHE_STORAGE_KEY = "ipo-analyzer:portfolio-prices:v1";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function posNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

function parseManualPrice(v: unknown): ManualPrice | null {
  if (!isRecord(v)) return null;
  const price = posNum(v.price);
  const date = isoOrNull(v.date);
  return price !== null && date !== null ? { price, date } : null;
}

function parseHolding(raw: unknown): Holding | null {
  if (!isRecord(raw)) return null;
  const { id, code } = raw;
  const buyPrice = posNum(raw.buyPrice);
  const shares = posNum(raw.shares);
  if (typeof id !== "string" || id === "" || typeof code !== "string" || code === "") return null;
  if (buyPrice === null || shares === null) return null;
  const strategy: HoldingStrategy = raw.strategy === "yutai" ? "yutai" : "other";
  const month = typeof raw.rightsMonth === "number" ? raw.rightsMonth : NaN;
  const rightsMonth = strategy === "yutai" && Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
  const sold = parseManualPrice(raw.sold);
  return {
    id,
    code,
    name: typeof raw.name === "string" ? raw.name : "",
    buyPrice,
    shares,
    buyDate: isoOrNull(raw.buyDate) ?? "",
    strategy,
    rightsMonth,
    earningsDate: isoOrNull(raw.earningsDate),
    memo: typeof raw.memo === "string" ? raw.memo : "",
    manualPrice: parseManualPrice(raw.manualPrice),
    sold,
  };
}

/** localStorage の値（unknown）を保有の一覧にする。形の崩れた行は落とす。 */
export function parseHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseHolding).filter((h): h is Holding => h !== null);
}

/** localStorage の値（unknown）を現在値の置き場にする。 */
export function parsePriceCache(raw: unknown): PriceCache {
  if (!isRecord(raw)) return {};
  const out: PriceCache = {};
  for (const [code, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const price = posNum(v.price);
    const asOf = isoOrNull(v.asOf);
    const source = v.source === "live" || v.source === "manual" || v.source === "yutai" ? v.source : null;
    if (price !== null && asOf !== null && source !== null) out[code] = { price, asOf, source };
  }
  return out;
}

/** 保有中（売却済みでない）か。 */
export function isOpen(h: Holding): boolean {
  return h.sold === null;
}

/** 証券コードの形（4 桁の英数字。例 "7203" / "138A"）。 */
export function isValidCode(code: string): boolean {
  return /^[0-9][0-9A-Z]{3}$/.test(code);
}
