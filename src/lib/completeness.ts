import type { Ipo } from "@/types/ipo";

// データ充足度の判定。純関数。UI（一覧・詳細カード）はこれで表示を切り替える。
//
// 判定基準（scratch/mobile-design.md §5）:
// - insufficient: 公開価格（offeringPrice）が null かつ 吸収金額（absorptionAmount）が 0
//   （＝ JPX 発見のスケルトンで、手動情報がほぼ何も入っていない状態）
// - partial: 公開価格はあるが、BB日程・売上成長率・VC比率のいずれかが未取得（既定値のまま）
// - full: 上記のいずれにも該当しない（主要項目が揃っている）

export type CompletenessLevel = "full" | "partial" | "insufficient";

export interface CompletenessResult {
  level: CompletenessLevel;
  /** 不足している項目の日本語ラベル一覧（UI表示用）。full の場合は空配列。 */
  missing: string[];
}

/** BB日程が未設定（開始・終了とも空文字）か。 */
function isBbPeriodMissing(ipo: Ipo): boolean {
  return ipo.bbPeriod.start === "" && ipo.bbPeriod.end === "";
}

/** 売上成長率が既定値（未取得）のままか。 */
function isSalesGrowthMissing(ipo: Ipo): boolean {
  return ipo.financials.revenueGrowth === 0;
}

/** VC比率が既定値（未取得）のままか。 */
function isVcRatioMissing(ipo: Ipo): boolean {
  return ipo.vcRatio === 0;
}

export function assessCompleteness(ipo: Ipo): CompletenessResult {
  if (ipo.offeringPrice === null && ipo.absorptionAmount === 0) {
    return {
      level: "insufficient",
      missing: ["公開価格", "吸収金額"],
    };
  }

  const missing: string[] = [];
  if (ipo.offeringPrice === null) missing.push("公開価格");
  if (ipo.absorptionAmount === 0) missing.push("吸収金額");
  if (isBbPeriodMissing(ipo)) missing.push("BB日程");
  if (isSalesGrowthMissing(ipo)) missing.push("売上成長率");
  if (isVcRatioMissing(ipo)) missing.push("VC比率");

  if (missing.length === 0) {
    return { level: "full", missing: [] };
  }
  return { level: "partial", missing };
}
