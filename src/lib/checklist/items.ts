import type { Ipo } from "@/types/ipo";
import type { ChecklistItem } from "./types";

// 各チェック項目の純関数。IPO投資勉強会から抽出した投資法則をルールベースで照合し、
// 判定（verdict）と日本語の根拠テキスト（detail）を返す。テスト対象。
// scoring/items.ts と同様、すべて (ipo, todayIso) => ChecklistItem 形式の純関数として実装する。

// ------------------------------------------------------------
// BBフェーズ
// ------------------------------------------------------------

// 1. 仮条件の位置: 想定価格に対して仮条件が上振れ/下振れしているか。
export function checkPriceRangeRevision(ipo: Ipo): ChecklistItem {
  const { assumedPrice, priceRange } = ipo;
  if (assumedPrice <= 0 || priceRange.high <= 0) {
    return {
      id: "price-range-revision",
      label: "仮条件の位置",
      verdict: "unknown",
      detail: "データ未確定。",
    };
  }
  if (priceRange.low > assumedPrice) {
    return {
      id: "price-range-revision",
      label: "仮条件の位置",
      verdict: "pass",
      detail: "仮条件が想定価格より上振れ（機関投資家人気の証拠）。",
    };
  }
  if (priceRange.high < assumedPrice) {
    return {
      id: "price-range-revision",
      label: "仮条件の位置",
      verdict: "fail",
      detail: "仮条件が想定価格より下振れ（不人気の証拠。申込回避が定石）。",
    };
  }
  return {
    id: "price-range-revision",
    label: "仮条件の位置",
    verdict: "warn",
    detail: "想定価格が仮条件レンジ内（中立）。",
  };
}

// 2. 吸収金額: 小さいほど需給タイト。
export function checkAbsorption(ipo: Ipo): ChecklistItem {
  const a = ipo.absorptionAmount;
  if (a < 10) {
    return {
      id: "absorption",
      label: "吸収金額",
      verdict: "pass",
      detail: `${a}億円。10億円未満の軽量案件で需給タイト。`,
    };
  }
  if (a < 30) {
    return {
      id: "absorption",
      label: "吸収金額",
      verdict: "warn",
      detail: `${a}億円。中規模案件。`,
    };
  }
  return {
    id: "absorption",
    label: "吸収金額",
    verdict: "fail",
    detail: `${a}億円。重量案件。`,
  };
}

// 3. 業績成長: 黒字/赤字と成長率の組み合わせ。
export function checkGrowth(ipo: Ipo): ChecklistItem {
  const g = ipo.financials.revenueGrowth;
  const profitable = ipo.financials.isProfitable;
  if (profitable && g >= 20) {
    const emphasis = g >= 30 ? "（高成長）" : "";
    return {
      id: "growth",
      label: "業績成長",
      verdict: "pass",
      detail: `黒字かつ売上成長率${g}%${emphasis}。`,
    };
  }
  if (profitable) {
    return {
      id: "growth",
      label: "業績成長",
      verdict: "warn",
      detail: `黒字だが売上成長率${g}%は成長率低め。`,
    };
  }
  if (g >= 30) {
    return {
      id: "growth",
      label: "業績成長",
      verdict: "warn",
      detail: `赤字だが売上成長率${g}%と高成長（黒字転換期なら妙味）。`,
    };
  }
  return {
    id: "growth",
    label: "業績成長",
    verdict: "fail",
    detail: `赤字かつ売上成長率${g}%と低成長。`,
  };
}

// 4. ロックアップ: VC比率・日数・1.5倍解除条項の組み合わせ。
export function checkLockup(ipo: Ipo): ChecklistItem {
  const { vcRatio, lockup } = ipo;
  if (vcRatio < 10) {
    return {
      id: "lockup",
      label: "ロックアップ",
      verdict: "pass",
      detail: "VC比率10%未満で出口売り圧力小。",
    };
  }
  if (lockup.days >= 180 && !lockup.hasPriceRelease) {
    return {
      id: "lockup",
      label: "ロックアップ",
      verdict: "pass",
      detail: "180日ロック・解除条項なし。",
    };
  }
  if (lockup.hasPriceRelease) {
    return {
      id: "lockup",
      label: "ロックアップ",
      verdict: "warn",
      detail: "公開価格1.5倍で解除の条項あり（タッチで急落リスク）。",
    };
  }
  if (lockup.days < 90) {
    return {
      id: "lockup",
      label: "ロックアップ",
      verdict: "fail",
      detail: "ロックアップが弱い。",
    };
  }
  return {
    id: "lockup",
    label: "ロックアップ",
    verdict: "warn",
    detail: `ロックアップ${lockup.days}日（中程度）。`,
  };
}

// 5. 主幹事: 大手証券かどうか。
const MAJOR_UNDERWRITERS = ["野村", "大和", "SMBC日興", "みずほ", "SBI"];

export function checkUnderwriter(ipo: Ipo): ChecklistItem {
  const isMajor = MAJOR_UNDERWRITERS.some((name) =>
    ipo.leadUnderwriter.includes(name),
  );
  return {
    id: "underwriter",
    label: "主幹事",
    verdict: isMajor ? "pass" : "warn",
    detail: isMajor
      ? `大手主幹事（${ipo.leadUnderwriter}）。`
      : `主幹事「${ipo.leadUnderwriter}」は大手以外。`,
  };
}

// 6. 公募売出構成: 放出比率・公募/売出の比率。
export function checkOfferingStructure(ipo: Ipo): ChecklistItem {
  if (ipo.offeringRatio > 30) {
    return {
      id: "offering-structure",
      label: "公募売出構成",
      verdict: "fail",
      detail: `放出比率${ipo.offeringRatio}%と30%超。`,
    };
  }
  if (ipo.saleShares >= ipo.publicShares) {
    return {
      id: "offering-structure",
      label: "公募売出構成",
      verdict: "warn",
      detail: "売出中心（既存株主の換金色）。",
    };
  }
  return {
    id: "offering-structure",
    label: "公募売出構成",
    verdict: "pass",
    detail: "公募中心。",
  };
}

// 7. 上場日程の過密度。
export function checkSchedule(ipo: Ipo): ChecklistItem {
  const dayCongested = ipo.sameDayListings >= 2;
  const weekCongested = ipo.sameWeekListings >= 3;
  if (dayCongested && weekCongested) {
    return {
      id: "schedule",
      label: "日程過密",
      verdict: "fail",
      detail: `同日上場${ipo.sameDayListings}件・同週上場${ipo.sameWeekListings}件。資金分散に注意。`,
    };
  }
  if (dayCongested || weekCongested) {
    return {
      id: "schedule",
      label: "日程過密",
      verdict: "warn",
      detail: "資金分散に注意。",
    };
  }
  return {
    id: "schedule",
    label: "日程過密",
    verdict: "pass",
    detail: "日程の過密はなし。",
  };
}

// 8. 出口案件警戒: VC比率高 × 売出中心。
export function checkDealType(ipo: Ipo): ChecklistItem {
  if (ipo.vcRatio > 30 && ipo.saleShares > ipo.publicShares) {
    return {
      id: "deal-type",
      label: "出口案件警戒",
      verdict: "warn",
      detail: `VC比率${ipo.vcRatio}%超×売出中心。ファンド出口案件の可能性。`,
    };
  }
  return {
    id: "deal-type",
    label: "出口案件警戒",
    verdict: "pass",
    detail: "出口案件の兆候は見られない。",
  };
}

// 9. マクロイベント: 機械判定不能、常に手動確認。
export function checkMacroEvent(): ChecklistItem {
  return {
    id: "macro-event",
    label: "マクロイベント",
    verdict: "manual",
    detail: "上場日前後のマクロイベント（FOMC・日銀会合・米雇用統計・CPI）との近接を確認。",
  };
}

// ------------------------------------------------------------
// 上場当日フェーズ
// ------------------------------------------------------------

// 1. 初値倍率: 公開価格に対する初値の倍率。
export function checkInitialPriceRatio(ipo: Ipo): ChecklistItem {
  if (ipo.offeringPrice === null || ipo.initialPrice === null) {
    return {
      id: "initial-price-ratio",
      label: "初値倍率",
      verdict: "unknown",
      detail: "初値形成待ち。",
    };
  }
  const ratio = ipo.initialPrice / ipo.offeringPrice;
  const ratioText = `初値${ratio.toFixed(1)}倍`;
  if (ratio <= 1.5) {
    return {
      id: "initial-price-ratio",
      label: "初値倍率",
      verdict: "pass",
      detail: `${ratioText}。1.5倍以内で高値掴みリスク小。`,
    };
  }
  if (ratio <= 2.0) {
    return {
      id: "initial-price-ratio",
      label: "初値倍率",
      verdict: "warn",
      detail: `${ratioText}。高値掴みに注意。`,
    };
  }
  return {
    id: "initial-price-ratio",
    label: "初値倍率",
    verdict: "fail",
    detail: `${ratioText}。初値高騰。高値掴み回避、セカンダリーは押し目待ち。`,
  };
}

// 2. 出来高消化率: 初日出来高が公開株数（公募+売出+OA）に占める割合。
export function checkInitialVolume(ipo: Ipo): ChecklistItem {
  const totalShares = ipo.publicShares + ipo.saleShares + ipo.overAllotment;
  if (ipo.initialVolume == null || totalShares <= 0) {
    return {
      id: "initial-volume",
      label: "出来高消化率",
      verdict: "manual",
      detail: "初値形成時の出来高が公開株数の50%以上か確認。",
    };
  }
  const rate = ipo.initialVolume / totalShares;
  const ratePercent = Math.round(rate * 1000) / 10;
  if (rate >= 0.5) {
    return {
      id: "initial-volume",
      label: "出来高消化率",
      verdict: "pass",
      detail: `初日出来高が公開株数の${ratePercent}%を消化。当選組の売りをこなした。`,
    };
  }
  return {
    id: "initial-volume",
    label: "出来高消化率",
    verdict: "fail",
    detail: `初日出来高は公開株数の${ratePercent}%にとどまる。`,
  };
}

// 3. 増担保規制。上場当日・セカンダリー共通で使用。
export function checkMarginRestriction(ipo: Ipo): ChecklistItem {
  if (ipo.marginRestriction === true) {
    return {
      id: "margin-restriction",
      label: "増担保規制",
      verdict: "warn",
      detail: "増担保規制中。短期的な失速に注意。",
    };
  }
  if (ipo.marginRestriction === false) {
    return {
      id: "margin-restriction",
      label: "増担保規制",
      verdict: "pass",
      detail: "増担保規制なし。",
    };
  }
  return {
    id: "margin-restriction",
    label: "増担保規制",
    verdict: "manual",
    detail: "増担保規制の有無を確認。",
  };
}

// ------------------------------------------------------------
// セカンダリーフェーズ
// ------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 1. 初決算: 決算またぎ回避の定石。
export function checkFirstEarnings(ipo: Ipo, todayIso: string): ChecklistItem {
  if (!ipo.firstEarningsDate) {
    return {
      id: "first-earnings",
      label: "初決算",
      verdict: "manual",
      detail: "上場後初の決算発表日を確認（決算またぎは回避が定石）。",
    };
  }
  const earningsDate = ipo.firstEarningsDate;
  if (todayIso < earningsDate) {
    const remaining = daysBetween(todayIso, earningsDate);
    if (remaining <= 14) {
      return {
        id: "first-earnings",
        label: "初決算",
        verdict: "fail",
        detail: `初決算まで${remaining}日。またぎ回避。`,
      };
    }
    return {
      id: "first-earnings",
      label: "初決算",
      verdict: "warn",
      detail: `初決算前（${earningsDate}予定）。`,
    };
  }
  return {
    id: "first-earnings",
    label: "初決算",
    verdict: "pass",
    detail: "初決算通過済み。良決算確認後は安全なエントリータイミング。",
  };
}

// 2. ロックアップ解除日の接近。
export function checkLockupExpiry(ipo: Ipo, todayIso: string): ChecklistItem {
  if (ipo.lockup.days > 0 && ipo.listingDate) {
    const expiryDate = addDaysIso(ipo.listingDate, ipo.lockup.days);
    const remaining = daysBetween(todayIso, expiryDate);
    if (remaining >= 0 && remaining <= 14) {
      return {
        id: "lockup-expiry",
        label: "ロック解除",
        verdict: "warn",
        detail: `ロックアップ解除日（${expiryDate}）接近。売り圧力に注意。`,
      };
    }
    if (remaining < 0) {
      return {
        id: "lockup-expiry",
        label: "ロック解除",
        verdict: "pass",
        detail: `ロックアップ解除通過済み（解除日: ${expiryDate}）。`,
      };
    }
    return {
      id: "lockup-expiry",
      label: "ロック解除",
      verdict: "pass",
      detail: `ロックアップ解除日: ${expiryDate}。`,
    };
  }
  return {
    id: "lockup-expiry",
    label: "ロック解除",
    verdict: "pass",
    detail: "ロックアップ情報なし。",
  };
}

// 3. 1.5倍解除ライン。
export function checkPriceReleaseLine(ipo: Ipo): ChecklistItem {
  if (!ipo.lockup.hasPriceRelease) {
    return {
      id: "price-release-line",
      label: "1.5倍ライン",
      verdict: "pass",
      detail: "価格解除条項なし。",
    };
  }
  if (ipo.offeringPrice === null || ipo.currentPrice == null) {
    return {
      id: "price-release-line",
      label: "1.5倍ライン",
      verdict: "unknown",
      detail: "公開価格または直近終値のデータ不足。",
    };
  }
  const releaseLine = ipo.offeringPrice * 1.5;
  if (ipo.currentPrice >= releaseLine) {
    return {
      id: "price-release-line",
      label: "1.5倍ライン",
      verdict: "fail",
      detail: "1.5倍ライン到達圏。解除売りに警戒、手前利確が定石。",
    };
  }
  if (ipo.currentPrice >= ipo.offeringPrice * 1.4) {
    return {
      id: "price-release-line",
      label: "1.5倍ライン",
      verdict: "warn",
      detail: `1.5倍ライン（${Math.round(releaseLine).toLocaleString()}円）接近。`,
    };
  }
  return {
    id: "price-release-line",
    label: "1.5倍ライン",
    verdict: "pass",
    detail: `1.5倍ライン（${Math.round(releaseLine).toLocaleString()}円）まで距離あり。`,
  };
}

// 4. TOPIX組み入れ（プライムのみ）: 上場翌月末が指数連動需要の発生タイミング。
export function checkTopixInclusion(
  ipo: Ipo,
  todayIso: string,
): ChecklistItem | null {
  if (ipo.market !== "プライム") return null;
  if (!ipo.listingDate) {
    return {
      id: "topix-inclusion",
      label: "TOPIX組み入れ",
      verdict: "unknown",
      detail: "上場日データ不足。",
    };
  }
  const listing = new Date(`${ipo.listingDate}T00:00:00Z`);
  // 上場翌月の末日 = 上場月の2ヶ月後の0日目
  const nextMonthEnd = new Date(
    Date.UTC(listing.getUTCFullYear(), listing.getUTCMonth() + 2, 0),
  );
  const nextMonthEndIso = nextMonthEnd.toISOString().slice(0, 10);
  if (todayIso <= nextMonthEndIso) {
    return {
      id: "topix-inclusion",
      label: "TOPIX組み入れ",
      verdict: "pass",
      detail: `${nextMonthEndIso}頃にTOPIX組み入れに伴う指数連動需要が見込まれる。`,
    };
  }
  return {
    id: "topix-inclusion",
    label: "TOPIX組み入れ",
    verdict: "pass",
    detail: "組み入れ通過済み。",
  };
}

// 5. 出来高水準: 市場からの放置サイン。
export function checkVolumeLevel(ipo: Ipo): ChecklistItem {
  if (ipo.recentVolume == null) {
    return {
      id: "volume-level",
      label: "出来高水準",
      verdict: "manual",
      detail: "直近の出来高水準を確認。",
    };
  }
  if (ipo.recentVolume >= 100000) {
    return {
      id: "volume-level",
      label: "出来高水準",
      verdict: "pass",
      detail: `直近出来高${ipo.recentVolume.toLocaleString()}株。`,
    };
  }
  return {
    id: "volume-level",
    label: "出来高水準",
    verdict: "fail",
    detail: "出来高10万株割れ。市場から放置のサイン、撤退目安。",
  };
}

// 6. 大量保有報告: 機関投資家の取得動向シグナル。
export function checkLargeHolding(ipo: Ipo): ChecklistItem {
  if (ipo.largeHoldingReport) {
    const { date, holder } = ipo.largeHoldingReport;
    return {
      id: "large-holding",
      label: "大量保有報告",
      verdict: "pass",
      detail: `${date} ${holder}が大量保有報告を提出（機関投資家の取得動向シグナル）。`,
    };
  }
  return {
    id: "large-holding",
    label: "大量保有報告",
    verdict: "manual",
    detail: "EDINETで大量保有報告書の提出を確認（出れば強い取得動向シグナル）。",
  };
}

// 7. 反発確認: 常に手動確認。
export function checkReboundConfirm(): ChecklistItem {
  return {
    id: "rebound-confirm",
    label: "反発確認",
    verdict: "manual",
    detail: "日足で陽線2日以上の反発を確認してからエントリー（下落途中で拾わない）。",
  };
}
