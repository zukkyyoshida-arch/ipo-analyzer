// IPO 銘柄のドメイン型定義。データソース（JSON / 将来のSupabase）に依存しない純粋な型。

export type Market = "グロース" | "スタンダード" | "プライム";

export type IpoStatus = "upcoming" | "bb_open" | "priced" | "listed";

export type PriceRangePosition = "upper" | "middle" | "lower" | null;

export interface DateRange {
  start: string; // ISO 日付 (YYYY-MM-DD)
  end: string;
}

export interface Lockup {
  days: number;
  /** 1.5倍解除条項（公開価格の1.5倍で解除）の有無 */
  hasPriceRelease: boolean;
  /** ロックアップ対象株式のカバレッジ（%）。発行済株式に対する拘束割合の目安 */
  coverage: number;
}

export interface Financials {
  /** 直近期売上高（百万円） */
  revenue: number;
  /** 売上成長率（%） */
  revenueGrowth: number;
  /** 営業利益（百万円）。赤字はマイナス */
  operatingProfit: number;
  isProfitable: boolean;
}

export interface Ipo {
  code: string;
  name: string;
  market: Market;
  sector: string;
  /** テーマタグ（AI/SaaS/半導体/セキュリティ/D2C/人材/インフラ/不人気/その他 等） */
  theme: string[];
  description: string;
  listingDate: string;
  bbPeriod: DateRange;
  allotmentDate: string;
  purchasePeriod: DateRange;
  /** 想定発行価格（円） */
  assumedPrice: number;
  /** 仮条件（円） */
  priceRange: { low: number; high: number };
  /** 公開価格（円）。未決定は null */
  offeringPrice: number | null;
  /** 公開価格の仮条件レンジ内での位置 */
  priceRangePosition: PriceRangePosition;
  /** 公募株数 */
  publicShares: number;
  /** 売出株数 */
  saleShares: number;
  /** オーバーアロットメント株数 */
  overAllotment: number;
  /** 吸収金額（億円、OA込み） */
  absorptionAmount: number;
  /** 売出・公募合計の発行済に対する比率（%） */
  offeringRatio: number;
  /** 想定時価総額（億円） */
  marketCap: number;
  /** VC等ファンドの保有比率（%） */
  vcRatio: number;
  lockup: Lockup;
  /** 主幹事証券会社名 */
  leadUnderwriter: string;
  underwriters: string[];
  financials: Financials;
  /** PER（倍）。赤字等で算出不能なら null */
  per: number | null;
  /** PSR（倍） */
  psr: number | null;
  /** 同日上場社数（自社含む） */
  sameDayListings: number;
  /** 同一週の上場社数（自社含む） */
  sameWeekListings: number;
  /** 初値（円）。上場済のみ、未上場は null */
  initialPrice: number | null;
  status: IpoStatus;
  /** 類似IPOの銘柄コード（実績参照用） */
  similarIpoCodes: string[];
}
