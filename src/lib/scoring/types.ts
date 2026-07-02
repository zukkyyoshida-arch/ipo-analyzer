// スコアリングの型定義。
// スコアは「需給スコア」と「ファンダスコア」の2軸。
// 各項目は生データを -2〜+2 の整数に正規化し、重み付き合計を 0〜100 に換算する。

/** 需給スコアの項目キー */
export type SupplyDemandItemKey =
  | "absorption"
  | "market"
  | "theme"
  | "vcLockup"
  | "offeringStructure"
  | "underwriter"
  | "sentiment"
  | "schedule"
  | "downside";

/** ファンダスコアの項目キー */
export type FundamentalItemKey = "growth" | "valuation";

export type ScoreItemKey = SupplyDemandItemKey | FundamentalItemKey;

/** 地合い（全銘柄共通、ユーザー設定） */
export type Sentiment = "strong" | "neutral" | "weak";

/** 重みプリセット */
export type WeightPreset = "supplyDemand" | "balanced" | "fundamental";

/** スコア重み（各項目 0 以上の整数）。ユーザーがスライダーで調整可 */
export type ScoreWeights = Record<ScoreItemKey, number>;

/** スコアリングに影響する設定 */
export interface ScoreSettings {
  weights: ScoreWeights;
  sentiment: Sentiment;
  /** 主幹事名 -> 係数（-2〜+2）。設定画面で調整、未設定なら 0 */
  underwriterCoefficients: Record<string, number>;
}

/** 1項目の計算結果 */
export interface ScoreItemResult {
  key: ScoreItemKey;
  /** 項目名（日本語） */
  label: string;
  /** 生データの説明（日本語） */
  rawText: string;
  /** 正規化後の点数（-2〜+2） */
  points: number;
  /** 適用された重み */
  weight: number;
  /** 寄与ポイント（points × weight） */
  contribution: number;
  /** 根拠テキスト（日本語） */
  reason: string;
}

/** 1軸（需給 or ファンダ）のスコア結果 */
export interface AxisScoreResult {
  /** 0〜100 に換算したスコア */
  score: number;
  items: ScoreItemResult[];
  /** 重み付き寄与ポイントの合計（換算前） */
  rawTotal: number;
  /** 取りうる寄与ポイントの最大合計 */
  maxTotal: number;
  /** 取りうる寄与ポイントの最小合計 */
  minTotal: number;
}

/** 銘柄全体のスコア結果 */
export interface IpoScoreResult {
  supplyDemand: AxisScoreResult;
  fundamental: AxisScoreResult;
}
