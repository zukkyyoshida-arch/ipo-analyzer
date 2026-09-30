import type { FinancialPeriod } from "@/types/enriched";
import type { CheckpointThresholds } from "./thresholds";
import type {
  CheckpointCounts,
  CheckpointInput,
  CheckpointResult,
  CheckpointSummary,
  CommonCheckpointId,
} from "./types";
import { currentPriceAtListingScale } from "@/lib/price";

// 共通チェックポイント（BB・短期セカンダリで共用）。資料の「初値買いのチェックポイント」＋講義の補足。
// すべて (input, thresholds) => CheckpointResult の純関数。データが無い項目は unknown を返し、落ちない。

type Check = (input: CheckpointInput, t: CheckpointThresholds) => CheckpointResult;

function result(
  id: CommonCheckpointId,
  label: string,
  verdict: CheckpointResult["verdict"],
  value: string,
  threshold: string,
  reason: string,
): CheckpointResult {
  return { id, label, verdict, value, threshold, reason };
}

function positive(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

function fmt1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** 株数を「123.4万株」で。1万株未満は「9,800株」。 */
export function formatShares(n: number): string {
  if (Math.abs(n) >= 10_000) return `${fmt1(n / 10_000)}万株`;
  return `${fmtInt(n)}株`;
}

// ------------------------------------------------------------
// 業績（3 年分）
// ------------------------------------------------------------

/** 決算期の文字列（例: "2025年2月期"）から並べ替え用の数値（年×100＋月）。読めなければ null。 */
export function periodSortKey(period: string): number | null {
  const m = /(\d{4})年\s*(\d{1,2})月/.exec(period);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

/** 実績期（「予想」を含まない、売上と営業利益がある期）を新しい順に。 */
export function actualPeriodsNewestFirst(history: readonly FinancialPeriod[]): FinancialPeriod[] {
  return history
    .map((p, index) => ({ p, index, key: periodSortKey(p.period) }))
    .filter(({ p }) => !p.period.includes("予想") && finite(p.revenue) && finite(p.operatingProfit))
    .sort((a, b) => {
      if (a.key !== null && b.key !== null && a.key !== b.key) return b.key - a.key;
      // 期が読めないときは元の並び（古い→新しい）の逆にする。
      return b.index - a.index;
    })
    .map(({ p }) => p);
}

interface PeriodChange {
  period: string;
  revenueUp: boolean;
  profitUp: boolean;
  /** 赤字で、かつ前期より赤字が大きい */
  lossWidened: boolean;
  /** 売上が前期の何倍か（前期が 0 以下なら null） */
  revenueMultiple: number | null;
}

function changeOf(cur: FinancialPeriod, prev: FinancialPeriod): PeriodChange {
  const rev = cur.revenue as number;
  const prevRev = prev.revenue as number;
  const op = cur.operatingProfit as number;
  const prevOp = prev.operatingProfit as number;
  return {
    period: cur.period,
    revenueUp: rev > prevRev,
    profitUp: op > prevOp,
    lossWidened: op < 0 && op < prevOp,
    revenueMultiple: prevRev > 0 ? rev / prevRev : null,
  };
}

export const checkGrowth3y: Check = ({ enriched }) => {
  const label = "3 年の業績";
  const threshold = "直近 2 期とも増収かつ営業増益";
  const periods = actualPeriodsNewestFirst(enriched?.financialHistory ?? []);
  if (periods.length < 2) {
    return result("growth3y", label, "unknown", "—", threshold, "比べられる実績期が 2 期に足りません。");
  }
  const changes: PeriodChange[] = [];
  for (let i = 0; i < Math.min(2, periods.length - 1); i++) {
    changes.push(changeOf(periods[i], periods[i + 1]));
  }
  const latest = changes[0];
  const good = changes.filter((c) => c.revenueUp && c.profitUp).length;
  const doubled = latest.revenueMultiple !== null && latest.revenueMultiple >= 2;
  const value = changes
    .map((c) => `${c.period.replace(/^\d{2}(\d{2})年/, "$1年")} ${c.revenueUp ? "増収" : "減収"}${c.profitUp ? "増益" : "減益"}`)
    .join("／");
  const doubledText = doubled ? `売上が前期の${fmt1(latest.revenueMultiple as number)}倍と倍増。` : "";

  if (!latest.revenueUp || latest.lossWidened) {
    const why = !latest.revenueUp ? "直近期が減収" : "直近期に赤字が拡大";
    return result("growth3y", label, "fail", value, threshold, `${why}。${doubledText}`);
  }
  if (good === changes.length && changes.length === 2) {
    return result("growth3y", label, "pass", value, threshold, `2 期続けて増収増益。${doubledText}`);
  }
  if (good >= 1) {
    const why = changes.length < 2 ? "比べられるのは 1 期だけで、その期は増収増益。" : "増収増益は 2 期のうち 1 期。";
    return result("growth3y", label, "warn", value, threshold, `${why}${doubledText}`);
  }
  return result("growth3y", label, "fail", value, threshold, `増収増益の期がありません。${doubledText}`);
};

// ------------------------------------------------------------
// 公募・売出
// ------------------------------------------------------------

export const checkOfferingMix: Check = ({ ipo }, t) => {
  const label = "公募と売出の割合";
  const threshold = `公募 ${t.publicRatioPassPct}%以上でクリア／${t.publicRatioFailPct}%以下で警戒`;
  const total = ipo.publicShares + ipo.saleShares;
  if (!(total > 0)) {
    return result("offeringMix", label, "unknown", "—", threshold, "公募・売出の株数が分かりません。");
  }
  const pct = (ipo.publicShares / total) * 100;
  const value = `公募 ${fmt1(pct)}%・売出 ${fmt1(100 - pct)}%`;
  if (pct >= t.publicRatioPassPct) {
    const why = pct >= 100 ? "すべて公募（新しく発行する株）。" : "公募が中心。";
    return result("offeringMix", label, "pass", value, threshold, why);
  }
  if (pct <= t.publicRatioFailPct) {
    return result("offeringMix", label, "fail", value, threshold, "売出が中心。既存株主の換金（IPO ゴール）に注意。");
  }
  return result("offeringMix", label, "warn", value, threshold, "公募と売出が半々に近い。");
};

export const checkSupplyShares: Check = ({ ipo }, t) => {
  const label = "公募＋売出の株数";
  const threshold = `${formatShares(t.supplySharesMax)}以下`;
  const total = ipo.publicShares + ipo.saleShares;
  if (!(total > 0)) {
    return result("supplyShares", label, "unknown", "—", threshold, "公募・売出の株数が分かりません。");
  }
  const value = formatShares(total);
  if (total <= t.supplySharesMax) {
    return result("supplyShares", label, "pass", value, threshold, "市場に出る株が少なく、需給が締まりやすい。");
  }
  if (total <= t.supplySharesMax * 2) {
    return result("supplyShares", label, "warn", value, threshold, "基準を超えるが 2 倍以内。");
  }
  return result("supplyShares", label, "fail", value, threshold, "市場に出る株が多く、値が重くなりやすい。");
};

// ------------------------------------------------------------
// VC・ロックアップ・ストックオプション
// ------------------------------------------------------------

export const checkVc: Check = ({ ipo, enriched }, t) => {
  const label = "VC の保有";
  const threshold = `VC ${t.vcRatioMaxPct}%以下／ロック無しの VC 株が無い`;
  const holding = enriched?.vcHoldingShares;
  const locked = enriched?.vcLockupShares;
  const known = finite(holding) || positive(ipo.vcRatio);
  if (!known) {
    return result("vc", label, "unknown", "—", threshold, "VC の保有状況が分かりません。");
  }
  const pct = ipo.vcRatio;
  const unlocked = finite(holding) && finite(locked) ? Math.max(0, holding - locked) : null;
  const parts = [`VC ${fmt1(pct)}%`];
  if (unlocked !== null && unlocked > 0) parts.push(`ロック無し ${formatShares(unlocked)}`);
  const value = parts.join("・");
  if (unlocked !== null && unlocked > 0) {
    return result("vc", label, "fail", value, threshold, "ロックの掛かっていない VC 株があり、上場直後に売られやすい。");
  }
  if (pct <= t.vcRatioMaxPct) {
    return result("vc", label, "pass", value, threshold, pct === 0 ? "VC の保有なし。" : "VC の保有が少ない。");
  }
  return result(
    "vc",
    label,
    "warn",
    value,
    threshold,
    unlocked === 0 ? "VC の保有は多いが、すべてロックが掛かっている。" : "VC の保有が多い。",
  );
};

export const checkLockup: Check = ({ ipo, enriched }, t) => {
  const label = "大株主のロックアップ";
  const threshold = `大株主全員が ${t.lockupFullDays}日以上`;
  const holders = enriched?.majorShareholders ?? [];
  if (holders.length === 0) {
    return result("lockup", label, "unknown", "—", threshold, "大株主の一覧がありません。");
  }
  const overall = ipo.lockup.days;
  const days = holders.map((h) => (h.lockupDays === null ? overall : h.lockupDays));
  const unlockedShares = holders.reduce((sum, h, i) => (days[i] <= 0 ? sum + h.shares : sum), 0);
  const unlockedCount = days.filter((d) => d <= 0).length;
  const shortCount = days.filter((d) => d > 0 && d < t.lockupFullDays).length;
  const release = ipo.lockup.hasPriceRelease;

  if (unlockedCount > 0) {
    return result(
      "lockup",
      label,
      "fail",
      `ロック無し ${unlockedCount}名・${formatShares(unlockedShares)}`,
      threshold,
      "ロックの掛かっていない大株主がいる。",
    );
  }
  const minDays = Math.min(...days);
  const value = `最短 ${fmtInt(minDays)}日${release ? "・1.5 倍解除あり" : ""}`;
  if (shortCount > 0 || release) {
    const why = [
      shortCount > 0 ? `${t.lockupFullDays}日に満たない大株主が ${shortCount}名` : "",
      release ? "公開価格の 1.5 倍で解除される条項あり" : "",
    ]
      .filter(Boolean)
      .join("。");
    return result("lockup", label, "warn", value, threshold, `${why}。`);
  }
  return result("lockup", label, "pass", value, threshold, `大株主全員が ${t.lockupFullDays}日以上ロック。`);
};

export const checkStockOption: Check = ({ enriched }, t) => {
  const label = "ストックオプション";
  const threshold = `発行済の ${t.stockOptionWarnPct}%未満`;
  const so = enriched?.stockOptionShares;
  const issued = enriched?.issuedShares;
  if (!finite(so) || !positive(issued)) {
    return result("stockOption", label, "unknown", "—", threshold, "ストックオプションか発行済株数が分かりません。");
  }
  const pct = (so / issued) * 100;
  const value = `${formatShares(so)}（${fmt1(pct)}%）`;
  if (pct >= t.stockOptionWarnPct) {
    return result("stockOption", label, "warn", value, threshold, "行使されると売りが出やすい。行使条件を目論見書で確かめる。");
  }
  return result("stockOption", label, "pass", value, threshold, so === 0 ? "ストックオプションなし。" : "ストックオプションは少なめ。");
};

// ------------------------------------------------------------
// 規模
// ------------------------------------------------------------

export const checkAbsorption: Check = ({ ipo }, t) => {
  const label = "吸収金額";
  const threshold = `${t.absorptionOkuMax}億円以下でクリア／${t.absorptionWarnOkuMax}億円以下で注意`;
  const a = ipo.absorptionAmount;
  if (!positive(a)) {
    return result("absorption", label, "unknown", "—", threshold, "吸収金額が分かりません。");
  }
  const value = `${fmt1(a)}億円`;
  if (a <= t.absorptionOkuMax) {
    return result("absorption", label, "pass", value, threshold, "小型で需給が締まりやすい。");
  }
  if (a <= t.absorptionWarnOkuMax) {
    return result("absorption", label, "warn", value, threshold, "中規模。");
  }
  return result("absorption", label, "fail", value, threshold, "大型で初値が伸びにくい。");
};

export const checkOa: Check = ({ ipo }) => {
  const label = "オーバーアロットメント";
  const threshold = "OA あり";
  if (!(ipo.publicShares + ipo.saleShares > 0)) {
    return result("oa", label, "unknown", "—", threshold, "公募・売出の株数が分かりません。");
  }
  if (ipo.overAllotment > 0) {
    return result("oa", label, "pass", formatShares(ipo.overAllotment), threshold, "公募割れのとき主幹事の買い（シンジケートカバー）が入りうる。");
  }
  return result("oa", label, "warn", "なし", threshold, "公募割れのときの下支えがない。");
};

/** 時価総額（億円）を「123億円」「1.2兆円」で。 */
function formatCap(oku: number): string {
  if (oku >= 10_000) return `${fmt1(oku / 10_000)}兆円`;
  return `${oku >= 100 ? fmtInt(oku) : fmt1(oku)}億円`;
}

export const checkMarketCapScenario: Check = ({ ipo, enriched }) => {
  const label = "時価総額のシナリオ";
  const threshold = "同業他社と比べる";
  const issued = enriched?.issuedShares;
  const offer = ipo.offeringPrice;
  const offerCap = positive(offer) && positive(issued) ? (offer * issued) / 1e8 : positive(ipo.marketCap) ? ipo.marketCap : null;
  const after = positive(ipo.initialPrice) ? ipo.initialPrice : currentPriceAtListingScale(ipo);
  const afterCap =
    positive(after) && positive(issued)
      ? (after * issued) / 1e8
      : positive(after) && positive(offer) && offerCap !== null
        ? (offerCap * after) / offer
        : null;
  const parts: string[] = [];
  if (offerCap !== null) parts.push(`公開価格で ${formatCap(offerCap)}`);
  if (afterCap !== null) parts.push(`${positive(ipo.initialPrice) ? "初値" : "現在値"}で ${formatCap(afterCap)}`);
  return result(
    "marketCapScenario",
    label,
    "unknown",
    parts.length > 0 ? parts.join("／") : "—",
    threshold,
    "同業他社の時価総額と見比べて、上値の余地を考える。",
  );
};

// ------------------------------------------------------------
// まとめ
// ------------------------------------------------------------

/** 並び順（画面の表示順）。 */
export const COMMON_CHECKS: readonly Check[] = [
  checkGrowth3y,
  checkOfferingMix,
  checkSupplyShares,
  checkVc,
  checkLockup,
  checkStockOption,
  checkAbsorption,
  checkOa,
  checkMarketCapScenario,
];

export function countVerdicts(items: readonly CheckpointResult[]): CheckpointCounts {
  const counts: CheckpointCounts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const item of items) counts[item.verdict] += 1;
  return counts;
}

/** 共通チェック 9 項目を全部当て、集計と一緒に返す。 */
export function runCommonCheckpoints(
  input: CheckpointInput,
  thresholds: CheckpointThresholds,
): CheckpointSummary {
  const items = COMMON_CHECKS.map((check) => check(input, thresholds));
  return { items, counts: countVerdicts(items) };
}

// ------------------------------------------------------------
// 一覧の行に出す理由チップ
// ------------------------------------------------------------

export interface CheckpointChip {
  id: CommonCheckpointId;
  text: string;
  tone: "good" | "bad";
}

/** チップの短い文言。 */
function chipText(item: CheckpointResult): string {
  switch (item.id) {
    case "growth3y":
      if (item.verdict === "pass") return item.reason.includes("倍増") ? "売上倍増・増収増益" : "2 期連続 増収増益";
      return item.reason.startsWith("直近期に赤字") ? "赤字拡大" : "直近期 減収";
    case "offeringMix":
      return item.value.split("・")[item.verdict === "pass" ? 0 : 1];
    case "supplyShares":
      return `公募＋売出 ${item.value}`;
    case "vc":
      return item.value;
    case "lockup":
      return item.verdict === "pass" ? "大株主 全員ロック" : item.value;
    case "stockOption":
      return `SO ${item.value}`;
    case "absorption":
      return `吸収 ${item.value}`;
    case "oa":
      return item.verdict === "pass" ? "OA あり" : "OA なし";
    case "marketCapScenario":
      return item.value;
  }
}

/**
 * 行に出す理由チップ（最大 max 件）。警戒（fail）を先に拾い、残りをクリア（pass）で埋める。
 * 表示はクリア → 警戒の順。
 */
export function checkpointChips(items: readonly CheckpointResult[], max = 3): CheckpointChip[] {
  const fails = items.filter((i) => i.verdict === "fail");
  const passes = items.filter((i) => i.verdict === "pass");
  const pickedFails = fails.slice(0, max);
  const pickedPasses = passes.slice(0, Math.max(0, max - pickedFails.length));
  return [
    ...pickedPasses.map((i) => ({ id: i.id, text: chipText(i), tone: "good" as const })),
    ...pickedFails.map((i) => ({ id: i.id, text: chipText(i), tone: "bad" as const })),
  ];
}
