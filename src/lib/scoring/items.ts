import type { Ipo } from "@/types/ipo";
import type { ScoreSettings, Sentiment } from "./types";

// 各スコア項目の純関数。生データを -2〜+2 の整数点数に正規化し、
// 併せて根拠テキスト（日本語）を返す。テスト対象。

export interface ItemOutput {
  points: number;
  rawText: string;
  reason: string;
}

/** 人気テーマタグ（需給スコアで加点対象） */
export const POPULAR_THEMES = ["AI", "SaaS", "半導体", "セキュリティ"] as const;
/** 不人気タグ（減点対象） */
export const UNPOPULAR_THEME = "不人気";

// 1. 吸収金額（億円、OA込み）: 小さいほど需給タイト。
export function scoreAbsorption(ipo: Ipo): ItemOutput {
  const a = ipo.absorptionAmount;
  let points: number;
  if (a < 10) points = 2;
  else if (a < 30) points = 1;
  else if (a < 100) points = 0;
  else if (a < 500) points = -1;
  else points = -2;
  return {
    points,
    rawText: `${a}億円`,
    reason: `吸収金額 ${a}億円。金額が小さいほど需給はタイトになりやすい。`,
  };
}

// 2. 市場区分: グロースは需給タイトになりやすい傾向。
export function scoreMarket(ipo: Ipo): ItemOutput {
  let points: number;
  if (ipo.market === "グロース") points = 1;
  else if (ipo.market === "スタンダード") points = 0;
  else points = -1; // プライム
  return {
    points,
    rawText: ipo.market,
    reason: `市場区分は${ipo.market}。`,
  };
}

// 3. 業種・テーマ性: 人気テーマ含む +2 / 中立 0 / 不人気タグ -2。
export function scoreTheme(ipo: Ipo): ItemOutput {
  const hasPopular = ipo.theme.some((t) =>
    (POPULAR_THEMES as readonly string[]).includes(t),
  );
  const hasUnpopular = ipo.theme.includes(UNPOPULAR_THEME);
  let points: number;
  let reason: string;
  if (hasUnpopular) {
    points = -2;
    reason = "不人気業種タグを含むため減点。";
  } else if (hasPopular) {
    points = 2;
    reason = "人気テーマタグ（AI/SaaS/半導体/セキュリティ）を含むため加点。";
  } else {
    points = 0;
    reason = "中立的なテーマ。";
  }
  return {
    points,
    rawText: ipo.theme.length > 0 ? ipo.theme.join("・") : "なし",
    reason,
  };
}

// 4. VC比率 × ロックアップ強度のマトリクス。
// ロック強度: 強[180日以上・1.5倍解除なし] / 中[90-180日 or 1.5倍解除あり] / 弱[90日未満かつ解除あり相当]
type LockStrength = "strong" | "medium" | "weak";

export function classifyLockStrength(ipo: Ipo): LockStrength {
  const { days, hasPriceRelease } = ipo.lockup;
  // 180日以上かつ解除条項なし: 最も拘束が強い
  if (days >= 180 && !hasPriceRelease) return "strong";
  // 90日未満: 拘束が弱い
  if (days < 90) return "weak";
  // それ以外（90-180日、または1.5倍解除あり）: 中
  return "medium";
}

type VcBucket = "low" | "mid" | "high";

function classifyVc(vcRatio: number): VcBucket {
  if (vcRatio < 10) return "low";
  if (vcRatio <= 30) return "mid";
  return "high";
}

// VC比率が高いほど、かつロックアップが弱いほど売り圧力が出やすい → 減点。
const VC_LOCKUP_MATRIX: Record<VcBucket, Record<LockStrength, number>> = {
  low: { strong: 2, medium: 1, weak: 0 },
  mid: { strong: 1, medium: 0, weak: -1 },
  high: { strong: 0, medium: -1, weak: -2 },
};

export function scoreVcLockup(ipo: Ipo): ItemOutput {
  const vc = classifyVc(ipo.vcRatio);
  const lock = classifyLockStrength(ipo);
  const points = VC_LOCKUP_MATRIX[vc][lock];
  const lockLabel =
    lock === "strong" ? "強" : lock === "medium" ? "中" : "弱";
  const releaseText = ipo.lockup.hasPriceRelease ? "・1.5倍解除あり" : "";
  return {
    points,
    rawText: `VC ${ipo.vcRatio}% / ロック${ipo.lockup.days}日${releaseText}`,
    reason: `VC比率${ipo.vcRatio}%（区分:${vc}）× ロックアップ強度「${lockLabel}」の組み合わせ。`,
  };
}

// 5. 公募売出比率: 公募>売出 +1 / 同程度 0 / 売出中心 -1、offeringRatio>30% でさらに -1（下限 -2）。
export function scoreOfferingStructure(ipo: Ipo): ItemOutput {
  const pub = ipo.publicShares;
  const sale = ipo.saleShares;
  let base: number;
  let structureText: string;
  // 同程度の判定は差が20%以内かどうか
  const larger = Math.max(pub, sale);
  const smaller = Math.min(pub, sale);
  const similar = larger === 0 ? true : (larger - smaller) / larger <= 0.2;
  if (similar) {
    base = 0;
    structureText = "公募と売出が同程度";
  } else if (pub > sale) {
    base = 1;
    structureText = "公募中心";
  } else {
    base = -1;
    structureText = "売出中心";
  }
  let points = base;
  let ratioNote = "";
  if (ipo.offeringRatio > 30) {
    points -= 1;
    ratioNote = `、放出比率${ipo.offeringRatio}%が30%超のため追加減点`;
  }
  if (points < -2) points = -2;
  return {
    points,
    rawText: `公募${pub.toLocaleString()}株 / 売出${sale.toLocaleString()}株 / 放出比率${ipo.offeringRatio}%`,
    reason: `${structureText}${ratioNote}。`,
  };
}

// 6. 主幹事: 証券会社マスタの係数（ユーザー設定可、デフォルト0）。
export function scoreUnderwriter(
  ipo: Ipo,
  settings: ScoreSettings,
): ItemOutput {
  const coefRaw = settings.underwriterCoefficients[ipo.leadUnderwriter];
  const coef = typeof coefRaw === "number" ? coefRaw : 0;
  const points = clampInt(coef, -2, 2);
  return {
    points,
    rawText: ipo.leadUnderwriter,
    reason: `主幹事「${ipo.leadUnderwriter}」の係数（設定値: ${points}）。`,
  };
}

// 7. 地合い: 全銘柄共通、ユーザー設定。
const SENTIMENT_POINTS: Record<Sentiment, number> = {
  strong: 2,
  neutral: 0,
  weak: -2,
};

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  strong: "強い",
  neutral: "普通",
  weak: "弱い",
};

export function scoreSentiment(settings: ScoreSettings): ItemOutput {
  const points = SENTIMENT_POINTS[settings.sentiment];
  return {
    points,
    rawText: SENTIMENT_LABELS[settings.sentiment],
    reason: `地合い設定「${SENTIMENT_LABELS[settings.sentiment]}」（全銘柄共通）。`,
  };
}

// 8. 上場日程の過密度: 同日上場あり -1、同週3件以上 さらに -1。
export function scoreSchedule(ipo: Ipo): ItemOutput {
  let points = 0;
  const notes: string[] = [];
  if (ipo.sameDayListings >= 2) {
    points -= 1;
    notes.push(`同日上場${ipo.sameDayListings}件`);
  }
  if (ipo.sameWeekListings >= 3) {
    points -= 1;
    notes.push(`同週上場${ipo.sameWeekListings}件`);
  }
  const reason =
    notes.length > 0
      ? `${notes.join("・")}のため減点。資金分散が起きやすい。`
      : "日程の過密はなし。";
  return {
    points,
    rawText: `同日${ipo.sameDayListings}件 / 同週${ipo.sameWeekListings}件`,
    reason,
  };
}

// 9. 公募割れリスクフラグ: 「吸収金額100億超 × 売出中心 × 人気テーマなし」で -2、それ以外 0。
export function scoreDownside(ipo: Ipo): ItemOutput {
  const largeAbsorption = ipo.absorptionAmount > 100;
  const saleHeavy = ipo.saleShares > ipo.publicShares;
  const noPopularTheme = !ipo.theme.some((t) =>
    (POPULAR_THEMES as readonly string[]).includes(t),
  );
  const flagged = largeAbsorption && saleHeavy && noPopularTheme;
  const reasons: string[] = [];
  if (largeAbsorption) reasons.push("吸収金額100億円超");
  if (saleHeavy) reasons.push("売出中心");
  if (noPopularTheme) reasons.push("人気テーマなし");
  return {
    points: flagged ? -2 : 0,
    rawText: flagged ? "該当" : "非該当",
    reason: flagged
      ? `複合条件に該当（${reasons.join("・")}）。公募割れに注意する要素が重なる。`
      : "複合的な公募割れリスク条件には該当せず。",
  };
}

// 10. 業績成長性: 成長率と黒字/赤字の組み合わせ。
export function scoreGrowth(ipo: Ipo): ItemOutput {
  const g = ipo.financials.revenueGrowth;
  const profitable = ipo.financials.isProfitable;
  let points: number;
  let reason: string;
  if (profitable && g > 30) {
    points = 2;
    reason = `売上成長率${g}%（>30%）かつ黒字。`;
  } else if (profitable && g > 15) {
    points = 1;
    reason = `売上成長率${g}%（>15%）かつ黒字。`;
  } else if (profitable) {
    points = 0;
    reason = `黒字だが成長率${g}%は低成長。`;
  } else if (g > 30) {
    // 赤字高成長
    points = -1;
    reason = `赤字だが売上成長率${g}%と高成長。`;
  } else {
    // 赤字低成長
    points = -2;
    reason = `赤字かつ成長率${g}%と低成長。`;
  }
  return {
    points,
    rawText: `成長率${g}% / ${profitable ? "黒字" : "赤字"}`,
    reason,
  };
}

// 11. バリュエーション: PSR で判定（赤字でPER算出不能でもPSRのみで判定）。
export function scoreValuation(ipo: Ipo): ItemOutput {
  const psr = ipo.psr;
  if (psr === null) {
    return {
      points: 0,
      rawText: "PSR: 算出不能",
      reason: "PSR が算出できないため中立。",
    };
  }
  let points: number;
  if (psr < 5) points = 1;
  else if (psr <= 15) points = 0;
  else points = -1;
  const perText = ipo.per === null ? "PER算出不能" : `PER ${ipo.per}倍`;
  return {
    points,
    rawText: `PSR ${psr}倍 / ${perText}`,
    reason: `PSR ${psr}倍で判定（${psr < 5 ? "割安圏" : psr <= 15 ? "中立" : "割高圏"}）。`,
  };
}

// -2〜+2 に丸める整数化ヘルパ。
export function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}
