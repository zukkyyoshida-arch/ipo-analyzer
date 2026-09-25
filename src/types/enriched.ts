// 96ut.com から取得した「補完データ」レイヤー。手動管理の base、updater管理の auto とは
// 別の第3のレイヤー。フィールドごとに出典URL・取得日時を持つ（同じ銘柄でもフィールドによって
// 取得元・鮮度が異なりうる現実を正確にモデル化する）。Ipo型はこのレイヤーの影響を受けない
// （merge.ts で base/auto 既定値フィールドのみ埋めるが、Ipo型そのものは拡張しない）。

/** 1フィールド分の出典情報。 */
export interface SourceRef {
  /** 取得元URL（例: https://kabu.96ut.com/article/ipo/2026035/） */
  url: string;
  /** 取得日時（ISO） */
  fetchedAt: string;
}

/** 幹事団1社分の割当情報。 */
export interface UnderwriterAllocation {
  name: string;
  /** 割当株数。取得不能なら null */
  shares: number | null;
  /** 割当比率（%）。取得不能なら null */
  ratioPercent: number | null;
  /** 抽選配分（枚＝100株単位）。96ut の「抽選配分」列。取得不能なら null／未取得は省略 */
  lotteryUnits?: number | null;
}

/** 大株主1件分。 */
export interface MajorShareholder {
  name: string;
  shares: number;
  ratioPercent: number;
  /** ロックアップ日数。個別記載が無ければ null（全体の lockup.days に従う） */
  lockupDays: number | null;
}

/** 会社概要。 */
export interface CompanyProfile {
  address: string | null;
  established: string | null;
  employeeCount: number | null;
  auditor: string | null;
}

/** 業績テーブル1期分。 */
export interface FinancialPeriod {
  /** 決算期（例: "2025年12月期"） */
  period: string;
  /** 単位: 百万円。96utの千円/百万円混在表記は取得時に正規化済み（§1.4 normalizeToMillionYen） */
  revenue: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  /** 売上高変化率（%） */
  revenueChangePercent: number | null;
}

/**
 * 96ut 由来の1銘柄分。すべて「取得できたものだけ」入る任意フィールド（code と sources/
 * fetchedAt/articleUrl のみ必須）。undefined はマージで無視する。
 */
export interface IpoEnriched {
  code: string;
  /** 取得元記事URL（レコード全体の代表URL。フィールド単位の出典は sources を見る）。 */
  articleUrl: string;
  /** このレコード全体の取得日時（フォールバック用）。 */
  fetchedAt: string;
  /** フィールドごとの出典。キーは下記フィールド名の文字列。 */
  sources: Partial<Record<string, SourceRef>>;

  // --- 日程 ---
  priceRangeDecisionDate?: string;
  bbPeriod?: { start: string; end: string };
  /** 公開価格決定日（=抽選日相当）。 */
  allotmentDate?: string;
  purchasePeriod?: { start: string; end: string };

  // --- 価格・株数 ---
  assumedPrice?: number;
  /** 仮条件。未発表なら省略。 */
  priceRange?: { low: number; high: number };
  offeringPrice?: number | null;
  publicShares?: number;
  saleShares?: number;
  overAllotment?: number;
  issuedShares?: number;
  offeringRatio?: number;
  /** 吸収金額（億円）。公開価格ベース。 */
  absorptionAmount?: number;
  /** 想定ベースの吸収金額（億円）。既存 absorptionAmount とは別枠。 */
  absorptionAmountAssumed?: number;
  /** 初値ベースの吸収金額（億円）。上場前は undefined。 */
  absorptionAmountInitial?: number;
  marketCap?: number;

  // --- 幹事 ---
  leadUnderwriter?: string;
  underwriters?: string[];
  underwriterAllocations?: UnderwriterAllocation[];

  // --- 会社概要・業績 ---
  companyProfile?: CompanyProfile;
  financialHistory?: FinancialPeriod[];
  eps?: number;
  bps?: number;
  dividendPerShare?: number;

  // --- 株主・VC・ロックアップ ---
  financials?: {
    revenue: number;
    revenueGrowth: number;
    operatingProfit: number;
    isProfitable: boolean;
  };
  vcRatio?: number;
  lockup?: { days: number; hasPriceRelease: boolean; coverage: number };
  majorShareholders?: MajorShareholder[];
  existingShareholderLockupShares?: number;
  existingShareholderLockupCoverage?: number;
  vcHoldingShares?: number;
  vcLockupShares?: number;
  stockOptionShares?: number;
}
