import type { Market } from "./ipo";

// 2015〜2023 年の IPO 履歴（96ut 記事から機械的に集計した圧縮データ）。
// 統計・バックテストの母数拡大用。2024 年以降は ipos.enriched.json 側に任せ、ここには含めない。
// 値が取れなかった項目は null（undefined は使わない）。

export interface HistoricalIpo {
  code: string;
  name: string;
  /** 現行区分へ読み替えた市場。地方市場・TOKYO PRO 等は null */
  market: Market | null;
  /** 上場日（YYYY-MM-DD） */
  listingDate: string;
  /** 公開価格（円） */
  offeringPrice: number | null;
  /** 初値（円）。初値が付かなかった・未取得は null */
  initialPrice: number | null;
  /** 想定発行価格（円） */
  assumedPrice: number | null;
  /** 仮条件（円） */
  priceRange: { low: number; high: number } | null;
  /** 吸収金額（億円）。公開価格ベース、無ければ想定価格ベース */
  absorptionAmount: number | null;
  /** 時価総額（億円） */
  marketCap: number | null;
  /** オファリング・レシオ（%） */
  offeringRatio: number | null;
  /** 売出比率（%）= 売出 ÷ (公募 + 売出) × 100 */
  saleRatio: number | null;
  publicShares: number | null;
  saleShares: number | null;
  overAllotment: number | null;
  leadUnderwriter: string | null;
  /** 幹事団の社数（主幹事を含む） */
  underwriterCount: number | null;
  /** VC 推定保有比率（%） */
  vcRatio: number | null;
  lockupDays: number | null;
  lockupHasPriceRelease: boolean | null;
  /** ロックアップのカバー率（%） */
  lockupCoverage: number | null;
  /** 直近実績期の売上高変化率（%） */
  revenueGrowth: number | null;
  isProfitable: boolean | null;
  sourceUrl: string;
  fetchedAt: string;
}
