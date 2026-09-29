// 自動更新パイプライン用のデータ型。
// - base: 手動管理フィールド（src/data/ipos.json 相当を public/data/ipos.base.json へ移行）
// - auto: updater 管理フィールド（JPX 由来のスケジュール・初値/現在値・自動テーマタグ・status 自動遷移）
// - market: 地合い自動判定結果
//
// アプリは base を土台に auto を重ねてドメイン型 Ipo を得る（src/lib/merge.ts）。

import type { Ipo, IpoStatus, Market, Sentiment } from "@/types/ipo";

/** base ファイルの1銘柄。手動管理する全フィールドを持つ完全な Ipo。 */
export type IpoBase = Ipo;

/**
 * auto ファイルの1銘柄。updater が上書き管理するフィールドのみを持つ部分レコード。
 * code は必須。それ以外は「取得できたものだけ」入る（undefined はマージで無視される）。
 */
export interface IpoAuto {
  code: string;
  /** JPX 由来の会社名（base 未登録の新規銘柄用） */
  name?: string;
  /** JPX 由来の市場区分 */
  market?: Market;
  /** JPX 由来の上場日（YYYY-MM-DD） */
  listingDate?: string;
  /** JPX 由来の主幹事（取得できた場合） */
  leadUnderwriter?: string;
  /** 自動遷移した status（upcoming→bb_open→priced→listed） */
  status?: IpoStatus;
  /** 自動付与したテーマタグ（base の手動タグとマージ、重複排除） */
  autoTheme?: string[];
  /** 初値（円・上場時の単位）。Yahoo Finance 由来、未取得は省略。分割調整済みの始値×splitFactor で戻した値 */
  initialPrice?: number | null;
  /** 現在値（円・現在の単位）。Yahoo Finance 由来 */
  currentPrice?: number | null;
  /** 上場日（初日）の出来高（株・上場時の単位）。Yahoo Finance 由来。分割調整済みの出来高÷splitFactor で戻した値 */
  initialVolume?: number | null;
  /** 直近の日次出来高（株・現在の単位）。Yahoo Finance 由来 */
  recentVolume?: number | null;
  /**
   * 上場日から今日までの累積株式分割係数（分割なしは 1、1:6 分割なら 6）。Yahoo Finance 由来。
   * 現在の単位の価格 × splitFactor = 上場時の単位の価格。未設定は 1 とみなす。
   */
  splitFactor?: number;
  /** 上場後最初の決算発表予定日（YYYY-MM-DD）。Yahoo Finance 由来（取得できた場合のみ） */
  firstEarningsDate?: string | null;
  /** 直近の大量保有報告書（EDINET API 由来）。取得できた場合のみ */
  largeHoldingReport?: { date: string; holder: string } | null;
  /** この auto レコードが JPX で新規発見された（base 未登録）ものか */
  discovered?: boolean;
  /** 最終更新時刻（ISO） */
  updatedAt?: string;
}

/** 地合い自動判定に用いた各指標 */
export interface MarketIndicators {
  /** 日経平均トレンド: 現在値が25日移動平均を上回れば up / 下回れば down / ほぼ同水準なら flat */
  nikkeiTrend: TrendDirection;
  /** グロース250（2516.T）トレンド。同上 */
  growth250Trend: TrendDirection;
  /** 直近上場銘柄の初値騰落率の平均（%）。データ不足なら null */
  recentIpoAvgReturn: number | null;
}

export type TrendDirection = "up" | "flat" | "down";

/** market.json の構造 */
export interface MarketData {
  /** 自動判定した地合い */
  sentiment: Sentiment;
  indicators: MarketIndicators;
  /** 判定時刻（ISO） */
  updatedAt: string;
}
