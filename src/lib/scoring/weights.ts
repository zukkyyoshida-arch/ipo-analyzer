import type {
  ScoreItemKey,
  ScoreWeights,
  SupplyDemandItemKey,
  FundamentalItemKey,
  WeightPreset,
} from "./types";

// 各軸に属する項目キー。UI とスコア集計の両方で参照する。
export const SUPPLY_DEMAND_KEYS: SupplyDemandItemKey[] = [
  "absorption",
  "market",
  "theme",
  "vcLockup",
  "offeringStructure",
  "underwriter",
  "sentiment",
  "schedule",
  "downside",
];

export const FUNDAMENTAL_KEYS: FundamentalItemKey[] = ["growth", "valuation"];

export const ALL_SCORE_KEYS: ScoreItemKey[] = [
  ...SUPPLY_DEMAND_KEYS,
  ...FUNDAMENTAL_KEYS,
];

/** 項目キー -> 日本語ラベル */
export const SCORE_ITEM_LABELS: Record<ScoreItemKey, string> = {
  absorption: "吸収金額",
  market: "市場区分",
  theme: "業種・テーマ性",
  vcLockup: "VC比率×ロックアップ",
  offeringStructure: "公募売出比率",
  underwriter: "主幹事",
  sentiment: "地合い",
  schedule: "上場日程の過密度",
  downside: "公募割れリスク",
  growth: "業績成長性",
  valuation: "バリュエーション",
};

// デフォルト重み（バランス型）。各項目の相対的な効き具合の目安。
const BALANCED_WEIGHTS: ScoreWeights = {
  absorption: 3,
  market: 1,
  theme: 3,
  vcLockup: 3,
  offeringStructure: 2,
  underwriter: 1,
  sentiment: 2,
  schedule: 1,
  downside: 3,
  growth: 3,
  valuation: 2,
};

// 需給重視: 需給項目の重みを厚くする。
const SUPPLY_DEMAND_WEIGHTS: ScoreWeights = {
  absorption: 4,
  market: 2,
  theme: 4,
  vcLockup: 4,
  offeringStructure: 3,
  underwriter: 2,
  sentiment: 3,
  schedule: 2,
  downside: 4,
  growth: 1,
  valuation: 1,
};

// ファンダ重視: 業績・バリュエーションの重みを厚くする。
const FUNDAMENTAL_WEIGHTS: ScoreWeights = {
  absorption: 2,
  market: 1,
  theme: 2,
  vcLockup: 2,
  offeringStructure: 1,
  underwriter: 1,
  sentiment: 1,
  schedule: 1,
  downside: 2,
  growth: 5,
  valuation: 4,
};

export const WEIGHT_PRESETS: Record<WeightPreset, ScoreWeights> = {
  balanced: BALANCED_WEIGHTS,
  supplyDemand: SUPPLY_DEMAND_WEIGHTS,
  fundamental: FUNDAMENTAL_WEIGHTS,
};

export const WEIGHT_PRESET_LABELS: Record<WeightPreset, string> = {
  supplyDemand: "需給重視",
  balanced: "バランス",
  fundamental: "ファンダ重視",
};

export const DEFAULT_WEIGHT_PRESET: WeightPreset = "balanced";

export function getPresetWeights(preset: WeightPreset): ScoreWeights {
  return { ...WEIGHT_PRESETS[preset] };
}

export const DEFAULT_WEIGHTS: ScoreWeights = getPresetWeights(
  DEFAULT_WEIGHT_PRESET,
);
