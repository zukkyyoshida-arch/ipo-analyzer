// 手法別チェックポイントのしきい値（設定画面で変えられる値）。純関数と定数だけを置く。
// 既定値は講師資料の基準（吸収金額 20 億・公募売出 100 万株・利確 2%/10% など）。
// 数値は年によって変わるため、コードの判定はすべてここの値を受け取って行う。

export interface CheckpointThresholds {
  /** 吸収金額がこれ以下なら pass（億円） */
  absorptionOkuMax: number;
  /** 吸収金額がこれ以下なら warn、超えたら fail（億円） */
  absorptionWarnOkuMax: number;
  /** 公募＋売出の株数がこれ以下なら pass（株） */
  supplySharesMax: number;
  /** 公募の比率（公募 ÷ 公募＋売出）がこれ以上なら pass（%） */
  publicRatioPassPct: number;
  /** 公募の比率がこれ以下なら fail（%） */
  publicRatioFailPct: number;
  /** VC の保有比率がこれ以下なら pass（%） */
  vcRatioMaxPct: number;
  /** ストックオプション ÷ 発行済がこれ以上なら warn（%） */
  stockOptionWarnPct: number;
  /** 大株主のロックアップがこの日数以上なら十分とみなす（日） */
  lockupFullDays: number;
  /** 予想初値 × この倍率以下なら「入る」目安 */
  entryBelowForecastRatio: number;
  /** 予想初値 × この倍率以上なら「見送り」目安 */
  skipAboveForecastRatio: number;
  /** 初値が公開価格の +この% を超えたら見送り（%） */
  skipAboveOfferingPct: number;
  /** 小さめの利確（%） */
  takeProfitPctSmall: number;
  /** 利確（%） */
  takeProfitPct: number;
  /** 損切り（%） */
  stopLossPct: number;
  /** 予想初値 ÷ 公開価格がこの倍率以上なら即金規制の可能性 */
  instantCashRegulationRatio: number;
  /** 投入資金（円） */
  capitalYen: number;
  /** 1 銘柄あたりの上限（投入資金に対する %） */
  maxPerStockPct: number;
  // ---- 中長期セカンダリ（講師の「10 のチェックポイント」）----
  /** 自己資本比率がこれ以上なら pass（%） */
  midEquityRatioPassPct: number;
  /** 自己資本比率がこれ以上なら warn（下回っても warn。候補からは外さない）（%） */
  midEquityRatioWarnPct: number;
  /** 信用買残 ÷ 20 日平均出来高がこれ以下なら pass（倍） */
  midMarginRatioPassX: number;
  /** 信用買残 ÷ 20 日平均出来高がこれ以下なら warn（超えても warn。文言だけ変える）（倍） */
  midMarginRatioWarnX: number;
  /** 時価総額がこれ以上なら pass（億円） */
  midMarketCapMinOku: number;
  /** 20 日平均出来高がこれ以上なら pass（株） */
  midVolumePass: number;
  /** 20 日平均出来高がこれ未満は fail（間は warn）（株） */
  midVolumeMin: number;
  /** 直近期の増収率の基準（%） */
  midGrowthRevenuePct: number;
  /** 直近期の営業増益率の基準（%） */
  midGrowthProfitPct: number;
  /** 直近期の営業利益率の基準（%） */
  midMarginPct: number;
}

/** 中長期セカンダリの講師基準（既定値・講師基準プリセット）。 */
const MID_LECTURER = {
  midEquityRatioPassPct: 50,
  midEquityRatioWarnPct: 30,
  midMarginRatioPassX: 10,
  midMarginRatioWarnX: 20,
  midMarketCapMinOku: 50,
  midVolumePass: 100_000,
  midVolumeMin: 50_000,
  midGrowthRevenuePct: 10,
  midGrowthProfitPct: 20,
  midMarginPct: 10,
} as const;

export const DEFAULT_THRESHOLDS: CheckpointThresholds = {
  absorptionOkuMax: 20,
  absorptionWarnOkuMax: 30,
  supplySharesMax: 1_000_000,
  publicRatioPassPct: 70,
  publicRatioFailPct: 50,
  vcRatioMaxPct: 10,
  stockOptionWarnPct: 10,
  lockupFullDays: 180,
  entryBelowForecastRatio: 0.9,
  skipAboveForecastRatio: 1.3,
  skipAboveOfferingPct: 300,
  takeProfitPctSmall: 2,
  takeProfitPct: 10,
  stopLossPct: 10,
  instantCashRegulationRatio: 2.3,
  capitalYen: 1_000_000,
  maxPerStockPct: 50,
  ...MID_LECTURER,
};

export type ThresholdPresetKey = "lecturer" | "conservative" | "aggressive";

export const THRESHOLD_PRESET_LABELS: Record<ThresholdPresetKey, string> = {
  lecturer: "講師基準",
  conservative: "保守",
  aggressive: "攻め",
};

/** プリセット。資金（capitalYen・maxPerStockPct）は人ごとに違うので、プリセットでは変えない。 */
export const THRESHOLD_PRESETS: Record<
  ThresholdPresetKey,
  Omit<CheckpointThresholds, "capitalYen" | "maxPerStockPct">
> = {
  lecturer: {
    absorptionOkuMax: 20,
    absorptionWarnOkuMax: 30,
    supplySharesMax: 1_000_000,
    publicRatioPassPct: 70,
    publicRatioFailPct: 50,
    vcRatioMaxPct: 10,
    stockOptionWarnPct: 10,
    lockupFullDays: 180,
    entryBelowForecastRatio: 0.9,
    skipAboveForecastRatio: 1.3,
    skipAboveOfferingPct: 300,
    takeProfitPctSmall: 2,
    takeProfitPct: 10,
    stopLossPct: 10,
    instantCashRegulationRatio: 2.3,
    ...MID_LECTURER,
  },
  conservative: {
    absorptionOkuMax: 10,
    absorptionWarnOkuMax: 20,
    supplySharesMax: 700_000,
    publicRatioPassPct: 80,
    publicRatioFailPct: 60,
    vcRatioMaxPct: 5,
    stockOptionWarnPct: 8,
    lockupFullDays: 180,
    entryBelowForecastRatio: 0.8,
    skipAboveForecastRatio: 1.2,
    skipAboveOfferingPct: 200,
    takeProfitPctSmall: 2,
    takeProfitPct: 8,
    stopLossPct: 7,
    instantCashRegulationRatio: 2.3,
    ...MID_LECTURER,
    midEquityRatioPassPct: 60,
    midEquityRatioWarnPct: 40,
    midMarginRatioPassX: 5,
    midMarginRatioWarnX: 10,
    midVolumePass: 200_000,
    midVolumeMin: 100_000,
  },
  aggressive: {
    absorptionOkuMax: 30,
    absorptionWarnOkuMax: 50,
    supplySharesMax: 2_000_000,
    publicRatioPassPct: 60,
    publicRatioFailPct: 40,
    vcRatioMaxPct: 20,
    stockOptionWarnPct: 15,
    lockupFullDays: 90,
    entryBelowForecastRatio: 1.0,
    skipAboveForecastRatio: 1.5,
    skipAboveOfferingPct: 400,
    takeProfitPctSmall: 3,
    takeProfitPct: 15,
    stopLossPct: 12,
    instantCashRegulationRatio: 2.3,
    ...MID_LECTURER,
    midEquityRatioPassPct: 30,
    midEquityRatioWarnPct: 20,
    midMarginRatioPassX: 20,
    midMarginRatioWarnX: 30,
    midVolumePass: 50_000,
    midVolumeMin: 30_000,
  },
};

/** 設定画面で数値を入れる項目の並び・表示名・単位・入力の刻み。 */
export const THRESHOLD_FIELDS: {
  key: keyof CheckpointThresholds;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "absorptionOkuMax", label: "吸収金額（クリア）", unit: "億円以下", min: 1, max: 500, step: 1 },
  { key: "absorptionWarnOkuMax", label: "吸収金額（注意）", unit: "億円以下", min: 1, max: 1000, step: 1 },
  { key: "supplySharesMax", label: "公募＋売出の株数", unit: "株以下", min: 10_000, max: 50_000_000, step: 100_000 },
  { key: "publicRatioPassPct", label: "公募の比率（クリア）", unit: "%以上", min: 0, max: 100, step: 5 },
  { key: "publicRatioFailPct", label: "公募の比率（警戒）", unit: "%以下", min: 0, max: 100, step: 5 },
  { key: "vcRatioMaxPct", label: "VC の保有比率", unit: "%以下", min: 0, max: 100, step: 1 },
  { key: "stockOptionWarnPct", label: "ストックオプション", unit: "%以上で注意", min: 0, max: 100, step: 1 },
  { key: "lockupFullDays", label: "大株主のロックアップ", unit: "日以上", min: 0, max: 1080, step: 30 },
  { key: "entryBelowForecastRatio", label: "入る上限（予想初値の）", unit: "倍", min: 0.1, max: 3, step: 0.05 },
  { key: "skipAboveForecastRatio", label: "見送り（予想初値の）", unit: "倍以上", min: 0.1, max: 5, step: 0.05 },
  { key: "skipAboveOfferingPct", label: "見送り（公開価格の）", unit: "%超の上昇", min: 0, max: 2000, step: 10 },
  { key: "takeProfitPctSmall", label: "利確（小）", unit: "%", min: 0.5, max: 100, step: 0.5 },
  { key: "takeProfitPct", label: "利確", unit: "%", min: 0.5, max: 200, step: 0.5 },
  { key: "stopLossPct", label: "損切り", unit: "%", min: 0.5, max: 100, step: 0.5 },
  { key: "instantCashRegulationRatio", label: "即金規制の目安（公開価格の）", unit: "倍以上", min: 1, max: 10, step: 0.1 },
];

/** 中長期セカンダリの入力項目（設定画面では小見出し「中長期セカンダリ」の下に並べる）。 */
export const MID_THRESHOLD_FIELDS: typeof THRESHOLD_FIELDS = [
  { key: "midGrowthRevenuePct", label: "増収率", unit: "%以上", min: 0, max: 200, step: 1 },
  { key: "midGrowthProfitPct", label: "営業増益率", unit: "%以上", min: 0, max: 500, step: 1 },
  { key: "midMarginPct", label: "営業利益率", unit: "%以上", min: 0, max: 100, step: 1 },
  { key: "midEquityRatioPassPct", label: "自己資本比率（クリア）", unit: "%以上", min: 0, max: 100, step: 5 },
  { key: "midEquityRatioWarnPct", label: "自己資本比率（注意）", unit: "%以上", min: 0, max: 100, step: 5 },
  { key: "midMarketCapMinOku", label: "時価総額", unit: "億円以上", min: 0, max: 10_000, step: 10 },
  { key: "midMarginRatioPassX", label: "信用買残（出来高の）", unit: "倍以下", min: 0, max: 200, step: 1 },
  { key: "midMarginRatioWarnX", label: "信用買残（注意）", unit: "倍以下", min: 0, max: 500, step: 1 },
  { key: "midVolumePass", label: "20 日平均出来高（クリア）", unit: "株以上", min: 0, max: 10_000_000, step: 10_000 },
  { key: "midVolumeMin", label: "20 日平均出来高（最低）", unit: "株以上", min: 0, max: 10_000_000, step: 10_000 },
];

/** 資金の入力項目。 */
export const CAPITAL_FIELDS: typeof THRESHOLD_FIELDS = [
  { key: "capitalYen", label: "投入資金", unit: "円", min: 0, max: 10_000_000_000, step: 100_000 },
  { key: "maxPerStockPct", label: "1 銘柄あたりの上限", unit: "%", min: 1, max: 100, step: 5 },
];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 保存データ（旧データでキーが無い・壊れた値を含みうる）を既定値で補った完全なしきい値にする。
 * @param raw localStorage から読んだ値（undefined 可）
 */
export function normalizeThresholds(raw: unknown): CheckpointThresholds {
  const out: CheckpointThresholds = { ...DEFAULT_THRESHOLDS };
  if (raw === null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof CheckpointThresholds)[]) {
    const v = obj[key];
    if (isFiniteNumber(v)) out[key] = v;
  }
  return out;
}

/** 現在の値に一致するプリセット（資金は見ない）。どれとも違えば null。 */
export function matchPreset(t: CheckpointThresholds): ThresholdPresetKey | null {
  for (const key of Object.keys(THRESHOLD_PRESETS) as ThresholdPresetKey[]) {
    const preset = THRESHOLD_PRESETS[key];
    const same = (Object.keys(preset) as (keyof typeof preset)[]).every((k) => preset[k] === t[k]);
    if (same) return key;
  }
  return null;
}

/** プリセットを当てた値（資金はそのまま残す）。 */
export function applyPreset(
  current: CheckpointThresholds,
  preset: ThresholdPresetKey,
): CheckpointThresholds {
  return { ...current, ...THRESHOLD_PRESETS[preset] };
}
