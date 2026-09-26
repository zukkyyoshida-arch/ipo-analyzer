import type { Ipo } from "@/types/ipo";
import type { IpoAuto, IpoBase } from "@/types/data";
import type { IpoEnriched } from "@/types/enriched";

// base（手動管理）を土台に auto（updater 管理）を重ねる薄い純関数。
//
// 原則:
// - 手動フィールドを auto が上書きしない。auto が上書きできるのは
//   「updater 管理と定めた限定フィールド」のみ（initialPrice / currentPrice /
//   status の前進 / 自動テーマタグの追加 / 新規発見銘柄の追加）。
// - JPX で見つかった未知の銘柄（base 未登録）は auto にスケルトンとして入り、
//   ここで最小限の Ipo を生成する。運用者は後から base に手動情報を追記できる。
// - enriched（96ut 由来の補完レイヤー）は base の「未取得の既定値」だけを埋める。
//   手動入力済みの値は上書きしない。優先順は base（手動）＞ enriched ＞ auto（価格系）。

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

type EmptyKind = "dateRange" | "date" | "price" | "count" | "generic";

/** base の該当フィールドが「未取得の既定値」かどうか。completeness.ts の判定と整合させる。 */
function isFieldEmpty(kind: EmptyKind, value: unknown): boolean {
  switch (kind) {
    case "dateRange": {
      const r = value as { start: string; end: string } | undefined;
      return !r || (r.start === "" && r.end === "");
    }
    case "date":
      return value === "" || value === null || value === undefined;
    case "price": {
      const p = value as { low: number; high: number } | undefined;
      return !p || (p.low === 0 && p.high === 0);
    }
    case "count":
      return value === 0;
    case "generic":
      return value === null || value === undefined;
  }
}

/**
 * CSV 取り込み由来の仮置き（想定価格・仮条件の上下限・公開価格がすべて同値）か。
 * 手動入力された仮条件（上下限が異なる）は仮置きとみなさない。
 */
function isPlaceholderPriceRange(ipo: Ipo): boolean {
  const { assumedPrice, priceRange, offeringPrice } = ipo;
  return (
    isPositive(assumedPrice) &&
    priceRange.low === priceRange.high &&
    priceRange.low === assumedPrice &&
    offeringPrice === assumedPrice
  );
}

/** 公開価格の仮条件レンジ内での位置。レンジ未取得（上下限同値）や公開価格未定は null。 */
export function derivePriceRangePosition(
  offeringPrice: number | null,
  priceRange: { low: number; high: number },
): Ipo["priceRangePosition"] {
  if (!isPositive(offeringPrice)) return null;
  if (!isPositive(priceRange.low) || !isPositive(priceRange.high)) return null;
  if (priceRange.low >= priceRange.high) return null;
  if (offeringPrice >= priceRange.high) return "upper";
  if (offeringPrice <= priceRange.low) return "lower";
  return "middle";
}

/** 埋め値として使える正の有限数か。 */
function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 埋め値として使える日付範囲か（開始・終了のどちらかが入っている）。 */
function isUsableRange(
  value: { start: string; end: string } | undefined,
): value is { start: string; end: string } {
  return !!value && (value.start !== "" || value.end !== "");
}

/**
 * base に enriched を重ねる。base の値が既定値（未取得）のときだけ enriched の値で埋める。
 * base に手動入力済みの値は enriched で上書きしない（本人が確認済みの情報を優先）。
 * skeletonFromAuto（新規発見銘柄）にも同じ規則で適用できるよう Ipo 全体を受け取る。
 * enriched が undefined なら引数の ipo をそのまま返す。
 */
export function applyEnriched(
  ipo: Ipo,
  enriched: IpoEnriched | undefined,
): Ipo {
  if (!enriched) return ipo;
  const e = enriched;
  const merged: Ipo = { ...ipo };

  // --- 日程 ---
  if (isFieldEmpty("dateRange", ipo.bbPeriod) && isUsableRange(e.bbPeriod)) {
    merged.bbPeriod = { ...e.bbPeriod };
  }
  if (isFieldEmpty("date", ipo.allotmentDate) && e.allotmentDate) {
    merged.allotmentDate = e.allotmentDate;
  }
  if (
    isFieldEmpty("dateRange", ipo.purchasePeriod) &&
    isUsableRange(e.purchasePeriod)
  ) {
    merged.purchasePeriod = { ...e.purchasePeriod };
  }

  // --- 価格・株数 ---
  if (isFieldEmpty("count", ipo.assumedPrice) && isPositive(e.assumedPrice)) {
    merged.assumedPrice = e.assumedPrice;
  }
  if (isFieldEmpty("count", ipo.publicShares) && isPositive(e.publicShares)) {
    merged.publicShares = e.publicShares;
  }
  if (isFieldEmpty("count", ipo.saleShares) && isPositive(e.saleShares)) {
    merged.saleShares = e.saleShares;
  }
  if (isFieldEmpty("count", ipo.overAllotment) && isPositive(e.overAllotment)) {
    merged.overAllotment = e.overAllotment;
  }
  if (isFieldEmpty("count", ipo.offeringRatio)) {
    if (isPositive(e.offeringRatio)) {
      merged.offeringRatio = e.offeringRatio;
    } else if (isPositive(e.issuedShares)) {
      // OR 未記載なら（公募＋売出）÷ 発行済株数で再計算する。
      const offered = merged.publicShares + merged.saleShares;
      if (offered > 0) {
        merged.offeringRatio =
          Math.round((offered / e.issuedShares) * 1000) / 10;
      }
    }
  }
  let rangeFromEnriched = false;
  if (isFieldEmpty("price", ipo.priceRange)) {
    if (
      e.priceRange &&
      isPositive(e.priceRange.low) &&
      isPositive(e.priceRange.high)
    ) {
      merged.priceRange = { low: e.priceRange.low, high: e.priceRange.high };
      rangeFromEnriched = true;
    } else if (isPositive(e.assumedPrice)) {
      // 仮条件未発表なら enriched の想定価格を low=high として採用する。
      merged.priceRange = { low: e.assumedPrice, high: e.assumedPrice };
    }
  } else if (isPlaceholderPriceRange(ipo)) {
    // CSV 取り込み（scripts/import_backtest_data.py）が「想定価格＝仮条件＝公開価格」で
    // 仮置きした銘柄は手動値ではないため、enriched の実際の想定価格・仮条件で置き換える。
    if (isPositive(e.assumedPrice)) {
      merged.assumedPrice = e.assumedPrice;
    }
    if (
      e.priceRange &&
      isPositive(e.priceRange.low) &&
      isPositive(e.priceRange.high)
    ) {
      merged.priceRange = { low: e.priceRange.low, high: e.priceRange.high };
      rangeFromEnriched = true;
    } else if (isPositive(e.assumedPrice)) {
      // 仮条件が未発表で想定価格だけある場合も low=high に揃える。旧仮置きレンジが残ると
      // 想定価格とずれ、scorePriceRangePosition が誤って加減点するため。
      merged.priceRange = { low: e.assumedPrice, high: e.assumedPrice };
    }
  }
  if (
    isFieldEmpty("generic", ipo.offeringPrice) &&
    isPositive(e.offeringPrice)
  ) {
    merged.offeringPrice = e.offeringPrice;
  }
  // 仮条件を enriched から入れた場合だけ、公開価格の位置を導出する（手動値は触らない）。
  if (rangeFromEnriched && merged.priceRangePosition === null) {
    merged.priceRangePosition = derivePriceRangePosition(
      merged.offeringPrice,
      merged.priceRange,
    );
  }
  if (isFieldEmpty("count", ipo.absorptionAmount)) {
    if (isPositive(e.absorptionAmount)) {
      merged.absorptionAmount = e.absorptionAmount;
    } else if (isPositive(e.absorptionAmountAssumed)) {
      // 公開価格が未決定（上場予定）の銘柄は想定価格ベースの吸収金額で埋める。
      merged.absorptionAmount = e.absorptionAmountAssumed;
    }
  }
  if (isFieldEmpty("count", ipo.marketCap) && isPositive(e.marketCap)) {
    merged.marketCap = e.marketCap;
  }

  // --- 幹事 ---
  if (isFieldEmpty("date", ipo.leadUnderwriter) && e.leadUnderwriter) {
    merged.leadUnderwriter = e.leadUnderwriter;
  }
  if (
    ipo.underwriters.length <= 1 &&
    e.underwriters &&
    e.underwriters.length > 0
  ) {
    // 主幹事を先頭に含めて統合・重複排除。
    const lead = merged.leadUnderwriter ? [merged.leadUnderwriter] : [];
    merged.underwriters = Array.from(
      new Set(
        [...lead, ...ipo.underwriters, ...e.underwriters].filter(
          (u) => u.length > 0,
        ),
      ),
    );
  }

  // --- 業績・VC・ロックアップ ---
  if (isFieldEmpty("count", ipo.financials.revenueGrowth) && e.financials) {
    merged.financials = { ...e.financials };
  }
  if (isFieldEmpty("count", ipo.vcRatio) && isPositive(e.vcRatio)) {
    merged.vcRatio = e.vcRatio;
  }
  if (
    isFieldEmpty("count", ipo.lockup.days) &&
    e.lockup &&
    isPositive(e.lockup.days)
  ) {
    merged.lockup = { ...e.lockup };
  }

  return merged;
}

/**
 * base 配列に auto 配列を重ね、最終的な Ipo 配列を返す。
 * - base に存在する銘柄: mergeOne で手動優先マージ
 * - auto にのみ存在する銘柄（新規発見）: skeletonFromAuto でスケルトン生成
 * 並び順は base の順序 → 続けて新規発見銘柄。
 * enriched（省略可）: base/スケルトンの未取得フィールドを埋める（applyEnriched）。
 * 省略時・空配列は従来と完全に同じ結果になる。
 * 処理順: base → applyEnriched → mergeOne(auto)。
 */
export function mergeIpos(
  base: IpoBase[],
  auto: IpoAuto[],
  enriched?: IpoEnriched[],
): Ipo[] {
  const autoByCode = new Map<string, IpoAuto>();
  for (const a of auto) autoByCode.set(a.code, a);

  const enrichedByCode = new Map<string, IpoEnriched>();
  for (const e of enriched ?? []) enrichedByCode.set(e.code, e);

  const baseCodes = new Set(base.map((b) => b.code));
  const result: Ipo[] = base.map((b) => {
    const filled = applyEnriched(b, enrichedByCode.get(b.code));
    const a = autoByCode.get(b.code);
    return a ? mergeOne(filled, a) : filled;
  });

  // base に無い auto 銘柄（新規発見）をスケルトンで追加し、enriched で補完する。
  for (const a of auto) {
    if (!baseCodes.has(a.code)) {
      result.push(
        applyEnriched(skeletonFromAuto(a), enrichedByCode.get(a.code)),
      );
    }
  }

  return result;
}
