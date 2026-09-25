import type { Ipo } from "@/types/ipo";
import type { IpoAuto, IpoBase } from "@/types/data";

// base（手動管理）を土台に auto（updater 管理）を重ねる薄い純関数。
//
// 原則:
// - 手動フィールドを auto が上書きしない。auto が上書きできるのは
//   「updater 管理と定めた限定フィールド」のみ（initialPrice / currentPrice /
//   status の前進 / 自動テーマタグの追加 / 新規発見銘柄の追加）。
// - JPX で見つかった未知の銘柄（base 未登録）は auto にスケルトンとして入り、
//   ここで最小限の Ipo を生成する。運用者は後から base に手動情報を追記できる。

/** status の進行順。auto は「前進」方向のみ反映し、手動で進めた状態を巻き戻さない。 */
const STATUS_ORDER: Record<Ipo["status"], number> = {
  upcoming: 0,
  bb_open: 1,
  priced: 2,
  listed: 3,
};

/** 新規発見銘柄用の Ipo スケルトン。手動情報は未確定として控えめな既定値を入れる。 */
export function skeletonFromAuto(auto: IpoAuto): Ipo {
  const listingDate = auto.listingDate ?? "";
  const emptyRange = { start: "", end: "" };
  return {
    code: auto.code,
    name: auto.name ?? auto.code,
    market: auto.market ?? "グロース",
    sector: "",
    theme: dedupeTheme(auto.autoTheme ?? []),
    description: "",
    listingDate,
    bbPeriod: emptyRange,
    allotmentDate: "",
    purchasePeriod: emptyRange,
    assumedPrice: 0,
    priceRange: { low: 0, high: 0 },
    offeringPrice: null,
    priceRangePosition: null,
    publicShares: 0,
    saleShares: 0,
    overAllotment: 0,
    absorptionAmount: 0,
    offeringRatio: 0,
    marketCap: 0,
    vcRatio: 0,
    lockup: { days: 0, hasPriceRelease: false, coverage: 0 },
    leadUnderwriter: auto.leadUnderwriter ?? "",
    underwriters: [],
    financials: {
      revenue: 0,
      revenueGrowth: 0,
      operatingProfit: 0,
      isProfitable: false,
    },
    per: null,
    psr: null,
    sameDayListings: 1,
    sameWeekListings: 1,
    initialPrice: auto.initialPrice ?? null,
    status: auto.status ?? "upcoming",
    similarIpoCodes: [],
    initialVolume: auto.initialVolume ?? null,
    currentPrice: auto.currentPrice ?? null,
    recentVolume: auto.recentVolume ?? null,
    firstEarningsDate: auto.firstEarningsDate ?? null,
    largeHoldingReport: auto.largeHoldingReport ?? null,
  };
}

/** テーマタグの重複を除去（順序は保持）。 */
function dedupeTheme(theme: string[]): string[] {
  return Array.from(new Set(theme.filter((t) => t.length > 0)));
}

/** 1銘柄分のマージ。base に auto を重ねる。手動フィールドは維持。 */
export function mergeOne(base: IpoBase, auto: IpoAuto): Ipo {
  const merged: Ipo = { ...base };

  // 初値・現在値は updater 管理。auto に値があれば反映（null で上書きはしない）。
  if (typeof auto.initialPrice === "number") {
    merged.initialPrice = auto.initialPrice;
  }
  if (typeof auto.currentPrice === "number") {
    merged.currentPrice = auto.currentPrice;
  }
  if (typeof auto.initialVolume === "number") {
    merged.initialVolume = auto.initialVolume;
  }
  if (typeof auto.recentVolume === "number") {
    merged.recentVolume = auto.recentVolume;
  }
  if (typeof auto.firstEarningsDate === "string" && auto.firstEarningsDate) {
    merged.firstEarningsDate = auto.firstEarningsDate;
  }
  if (auto.largeHoldingReport) {
    merged.largeHoldingReport = auto.largeHoldingReport;
  }

  // status は前進のみ。手動で進めた状態を auto が巻き戻さない。
  if (auto.status && STATUS_ORDER[auto.status] > STATUS_ORDER[base.status]) {
    merged.status = auto.status;
  }

  // 自動テーマタグは手動タグへ追加（重複排除）。手動タグは維持。
  if (auto.autoTheme && auto.autoTheme.length > 0) {
    merged.theme = dedupeTheme([...base.theme, ...auto.autoTheme]);
  }

  return merged;
}

/**
 * base 配列に auto 配列を重ね、最終的な Ipo 配列を返す。
 * - base に存在する銘柄: mergeOne で手動優先マージ
 * - auto にのみ存在する銘柄（新規発見）: skeletonFromAuto でスケルトン生成
 * 並び順は base の順序 → 続けて新規発見銘柄。
 */
export function mergeIpos(base: IpoBase[], auto: IpoAuto[]): Ipo[] {
  const autoByCode = new Map<string, IpoAuto>();
  for (const a of auto) autoByCode.set(a.code, a);

  const baseCodes = new Set(base.map((b) => b.code));
  const result: Ipo[] = base.map((b) => {
    const a = autoByCode.get(b.code);
    return a ? mergeOne(b, a) : b;
  });

  // base に無い auto 銘柄（新規発見）をスケルトンで追加。
  for (const a of auto) {
    if (!baseCodes.has(a.code)) {
      result.push(skeletonFromAuto(a));
    }
  }

  return result;
}
