// スクリーナーの純関数群。プリセット3種＋手動条件の適用ロジック。
// UIから独立しており、テスト（screener.test.ts）で境界値を検証する。

import type { Ipo, Market } from "@/types/ipo";

/** プリセットID。'custom' は手動編集で条件を変えたときの表示用（適用ロジックは持たない）。 */
export type ScreenerPresetId = "growthLiquidity" | "bbCandidate" | "watchlist";

export interface ScreenerPreset {
  id: ScreenerPresetId;
  label: string;
  /** プリセットの説明文（1行）。UIで表示する。 */
  description: string;
  criteria: ScreenerCriteria;
}

/** 手動条件（プリセット適用時もこの形に変換して保持する）。 */
export interface ScreenerCriteria {
  /** 売上成長率の下限（%）。null は条件なし。 */
  minRevenueGrowth: number | null;
  /** VC比率の上限（%）。null は条件なし。 */
  maxVcRatio: number | null;
  /** 吸収金額の上限（億円）。null は条件なし。 */
  maxAbsorptionAmount: number | null;
  /** 対象市場。空配列は「すべて」（条件なし）。 */
  markets: Market[];
  /** 黒字のみ。 */
  profitableOnly: boolean;
  /** 上場からの日数の上限。null は条件なし。基準日は ctx.today。 */
  maxDaysSinceListing: number | null;
  /** ウォッチ中のみ。 */
  watchedOnly: boolean;
  /** 直近出来高の下限（株）。null は条件なし。 */
  minRecentVolume: number | null;
  /** 現在値が初値以上（順張り条件）。 */
  currentAboveInitial: boolean;
  /** オファリングレシオ（offeringRatio）の上限（%）。null は条件なし。0（未取得）は除外しない。 */
  maxOfferingRatio: number | null;
  /** status を upcoming/bb_open/priced に限定するか。 */
  activeOnly: boolean;
}

/** 条件なし（すべて表示）の既定値。 */
export const EMPTY_CRITERIA: ScreenerCriteria = {
  minRevenueGrowth: null,
  maxVcRatio: null,
  maxAbsorptionAmount: null,
  markets: [],
  profitableOnly: false,
  maxDaysSinceListing: null,
  watchedOnly: false,
  minRecentVolume: null,
  currentAboveInitial: false,
  maxOfferingRatio: null,
  activeOnly: false,
};

export const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    id: "growthLiquidity",
    label: "高成長×流動性",
    description:
      "売上成長率30%以上・直近出来高50万株以上・現在値が初値以上の銘柄に絞り込みます。",
    criteria: {
      ...EMPTY_CRITERIA,
      minRevenueGrowth: 30,
      minRecentVolume: 500_000,
      currentAboveInitial: true,
    },
  },
  {
    id: "bbCandidate",
    label: "BB参加候補",
    description:
      "BB受付中または受付前でグロース市場・吸収金額30億円以下・オファリングレシオ30%以下の銘柄に絞り込みます。",
    criteria: {
      ...EMPTY_CRITERIA,
      activeOnly: true,
      maxAbsorptionAmount: 30,
      maxOfferingRatio: 30,
      markets: ["グロース"],
    },
  },
  {
    id: "watchlist",
    label: "ウォッチ中",
    description: "ウォッチリストに追加している銘柄のみ表示します。",
    criteria: {
      ...EMPTY_CRITERIA,
      watchedOnly: true,
    },
  },
];

export function getPresetById(id: ScreenerPresetId): ScreenerPreset {
  const preset = SCREENER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}

/** スコア計算結果（一覧側で計算済みのものを渡す）。 */
export interface ScreenerScore {
  supply: number;
  funda: number;
  overall: number;
}

export interface ScreenerContext {
  /** ウォッチ中かどうかの判定関数。 */
  watched: (code: string) => boolean;
  /** 銘柄コード -> スコア（一覧側で計算済み）。 */
  scored: Map<string, ScreenerScore>;
  /** 基準日（YYYY-MM-DD）。上場からの日数条件の計算に使う。省略時は条件を無視。 */
  today?: string;
}

/** 2つの YYYY-MM-DD の差（today - listingDate）を日数で返す。パース不能なら null。 */
function daysSinceListing(listingDate: string, today: string): number | null {
  const listed = Date.parse(`${listingDate}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(listed) || Number.isNaN(base)) return null;
  return Math.round((base - listed) / (24 * 3600 * 1000));
}

function matches(
  ipo: Ipo,
  criteria: ScreenerCriteria,
  ctx: ScreenerContext,
): boolean {
  if (criteria.watchedOnly && !ctx.watched(ipo.code)) return false;

  if (
    criteria.minRevenueGrowth !== null &&
    ipo.financials.revenueGrowth < criteria.minRevenueGrowth
  ) {
    return false;
  }

  if (criteria.maxVcRatio !== null && ipo.vcRatio > criteria.maxVcRatio) {
    return false;
  }

  if (
    criteria.maxAbsorptionAmount !== null &&
    ipo.absorptionAmount > criteria.maxAbsorptionAmount
  ) {
    return false;
  }

  if (criteria.markets.length > 0 && !criteria.markets.includes(ipo.market)) {
    return false;
  }

  if (criteria.profitableOnly && !ipo.financials.isProfitable) {
    return false;
  }

  if (criteria.maxDaysSinceListing !== null) {
    if (!ctx.today) return false;
    const days = daysSinceListing(ipo.listingDate, ctx.today);
    if (days === null || days < 0 || days > criteria.maxDaysSinceListing) {
      return false;
    }
  }

  if (criteria.minRecentVolume !== null) {
    const volume = ipo.recentVolume ?? null;
    if (volume === null || volume < criteria.minRecentVolume) return false;
  }

  if (criteria.currentAboveInitial) {
    const current = ipo.currentPrice ?? null;
    const initial = ipo.initialPrice ?? null;
    if (current === null || initial === null || current < initial) {
      return false;
    }
  }

  // オファリングレシオ: 0（未取得）は除外しない。
  if (
    criteria.maxOfferingRatio !== null &&
    ipo.offeringRatio !== 0 &&
    ipo.offeringRatio > criteria.maxOfferingRatio
  ) {
    return false;
  }

  if (criteria.activeOnly) {
    const activeStatuses = ["upcoming", "bb_open", "priced"] as const;
    if (!activeStatuses.includes(ipo.status as (typeof activeStatuses)[number])) {
      return false;
    }
  }

  return true;
}

export interface ScreenerResultEntry {
  ipo: Ipo;
  score: ScreenerScore | null;
  /** completeness が insufficient（=スコア対象外）かどうか。scored に無ければ true とみなす。 */
  insufficient: boolean;
}

/**
 * 条件に一致する銘柄を返す（純関数）。
 * 並び: 総合スコア降順。insufficient（スコア対象外）は末尾にまとめ、上場日が近い順。
 */
export function applyScreener(
  ipos: Ipo[],
  criteria: ScreenerCriteria,
  ctx: ScreenerContext,
): ScreenerResultEntry[] {
  const matched = ipos.filter((ipo) => matches(ipo, criteria, ctx));

  const entries: ScreenerResultEntry[] = matched.map((ipo) => {
    const score = ctx.scored.get(ipo.code) ?? null;
    return { ipo, score, insufficient: score === null };
  });

  entries.sort((a, b) => {
    if (a.insufficient !== b.insufficient) {
      return a.insufficient ? 1 : -1;
    }
    if (!a.insufficient && !b.insufficient) {
      return (b.score?.overall ?? 0) - (a.score?.overall ?? 0);
    }
    return a.ipo.listingDate.localeCompare(b.ipo.listingDate);
  });

  return entries;
}

/** 手動編集の結果、いずれかのプリセットと一致するかを判定する（一致しなければ「カスタム」表示）。 */
export function matchesAnyPreset(criteria: ScreenerCriteria): ScreenerPresetId | null {
  for (const preset of SCREENER_PRESETS) {
    if (criteriaEqual(criteria, preset.criteria)) return preset.id;
  }
  return null;
}

function criteriaEqual(a: ScreenerCriteria, b: ScreenerCriteria): boolean {
  return (
    a.minRevenueGrowth === b.minRevenueGrowth &&
    a.maxVcRatio === b.maxVcRatio &&
    a.maxAbsorptionAmount === b.maxAbsorptionAmount &&
    a.profitableOnly === b.profitableOnly &&
    a.maxDaysSinceListing === b.maxDaysSinceListing &&
    a.watchedOnly === b.watchedOnly &&
    a.minRecentVolume === b.minRecentVolume &&
    a.currentAboveInitial === b.currentAboveInitial &&
    a.maxOfferingRatio === b.maxOfferingRatio &&
    a.activeOnly === b.activeOnly &&
    sameMarkets(a.markets, b.markets)
  );
}

function sameMarkets(a: Market[], b: Market[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}
