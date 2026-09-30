// 注目度の上位に出た銘柄の「その後」の過去検証（scratch/backtest/hot_backtest.py・report-hot.md）。
// 2024年7月〜2026年9月、評価日511日（対象30件以上の日）。毎日の上位10件を、その日の終値で買った場合。
// 売買推奨ではなく、画面の注記の根拠。数字を変えるときは検証を回し直して揃える。

export const HOT_BACKTEST = {
  period: "2024年7月〜2026年9月",
  evalDays: 511,
  /** 上位10件の5営業日後: ほかの銘柄と区別できない（平均 +0.3% 対 +0.2%） */
  top10After5: { meanPct: 0.3, othersMeanPct: 0.2 },
  /** 上位10件の20営業日後 */
  top10After20: {
    /** 上がった割合（%） */
    upRatePct: 48.4,
    meanPct: 2.9,
    medianPct: -0.5,
    /** −20% 以下になった割合（%） */
    downOver20Pct: 10.0,
    /** +20% 以上になった割合（%） */
    upOver20Pct: 15.0,
  },
  /** 初値 ÷ 公開価格が 1.5 倍を超えた銘柄が上位10件に出たときの20営業日後（36銘柄） */
  overheatedAfter20: {
    ratio: 1.5,
    upRatePct: 34.9,
    meanPct: -5.2,
    medianPct: -6.4,
    stocks: 36,
  },
} as const;

/** 上位に出た銘柄のその後（常に出す短い注記）。 */
export const HOT_CAUTION_NOTE =
  "上位に出た銘柄も、その後20営業日で上がったのは約半数でした。値動きは大きく、4件に1件は±20%を超えて動きました（過去検証）。";

/**
 * 過熱注意の注記。注意ラインが検証と同じ 1.5 倍のときだけ検証の数字を添え、
 * ほかの注意ライン（型の設定）では数字を出さない。
 */
export function overheatNote(overheatRatio: number): string {
  const v = HOT_BACKTEST.overheatedAfter20;
  if (Math.abs(overheatRatio - v.ratio) < 1e-9) {
    return `過熱注意: 初値が公開価格の${v.ratio.toFixed(1)}倍超。同じ条件で上位に出た銘柄は、20営業日後に上がったのが約${Math.round(v.upRatePct)}%、平均は約${v.meanPct < 0 ? "−" : "+"}${Math.round(Math.abs(v.meanPct))}%でした（過去検証）。`;
  }
  return `過熱注意: 初値が公開価格の${overheatRatio.toFixed(1)}倍を超えた銘柄です（セカンダリーの型の注意ライン）。`;
}
