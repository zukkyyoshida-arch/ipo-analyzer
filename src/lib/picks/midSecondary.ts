import type { Ipo } from "@/types/ipo";
import type { CheckpointEnriched, CheckpointVerdict } from "@/lib/checkpoints/types";
import { actualPeriodsNewestFirst, periodSortKey } from "@/lib/checkpoints/common";
import { addDaysIso, daysBetween } from "@/lib/date";
import { splitFactor } from "@/lib/price";
import { currentTier, type MidFile, type MidItem, type MidTier } from "@/lib/midterm/file";

// ホームの「ピックアップ」→「中長期セカンダリ」。上場後に大きく下げた IPO 銘柄の反発狙い。
// 夜間の midterm.json（上場来高値からの下落率・安値・出来高）に、銘柄データ（ロックアップ・業績・決算日・発行済株式数）
// を当ててチェックし、候補を並べる純関数。
//
// 既定値の根拠は過去検証 scratch/backtest/report-midterm.md（2024〜2026 上場 166 銘柄）:
// - 上場来高値から −60% に初めて届いた翌営業日の寄りで買い、20 営業日後の引けで売ると平均 +7.7%
//   （95% 信頼区間 +2.6〜+13.2%、勝率 54%、n=74）。−40%・−50% は根拠なし（段階表示だけ）。
// - 出来高の減少・安値からの反発の確認は効果なし（反発を待つとむしろ悪化）→ 判定に使わない。
// - 利確 +10%／損切り −10% を固定すると平均が +7.7% → +2.6% に下がる → 固定しない。
// - 初決算またぎは標本 3 件で検証できていない → 警告だけ。

/** 検証の数字（注記に使う）。 */
export const MID_BACKTEST = {
  period: "2024〜2026 年上場の 166 銘柄",
  tier: 60,
  holdDays: 20,
  meanPct: 7.7,
  ciLowPct: 2.6,
  ciHighPct: 13.2,
  winRatePct: 54,
  n: 74,
  hold60MeanPct: 6.4,
  hold60WinRatePct: 58,
  fixedExitMeanPct: 2.6,
} as const;

/** 主基準（pass）の下落率（%）。 */
export const MID_PASS_TIER: MidTier = 60;
/** 注意（warn）の下落率（%）。 */
export const MID_WARN_TIER: MidTier = 50;
/** 20 日平均出来高の下限（株）。これ以上で pass。 */
export const MID_VOLUME_PASS = 100_000;
/** 20 日平均出来高の最低ライン（株）。これ未満は fail、間は warn。 */
export const MID_VOLUME_MIN = 50_000;
/**
 * 時価総額の下限（億円）。これ以上で pass、下回ったら warn（候補からは外さない）。設計書 §2-4「50 億以上」に合わせる。
 * しきい値の設定（CheckpointThresholds）に該当項目が無いため定数で置く（仮置き）。
 */
export const MID_MARKET_CAP_MIN_OKU = 50;
/** ロックアップの既定日数（銘柄データに無いとき）。 */
export const MID_LOCKUP_DEFAULT_DAYS = 180;
/** 業績の基準（直近期）: 増収率・営業増益率・営業利益率（%）。 */
export const MID_GROWTH = { revenuePct: 10, profitPct: 20, marginPct: 10 } as const;
/** 保有の目安（営業日）と、それを暦日に直した日数（決算またぎの判定に使う）。 */
export const MID_HOLD_BUSINESS_DAYS = 20;
export const MID_HOLD_CALENDAR_DAYS = 28;
/** 四半期末から決算発表までの日数の目安（東証の要請は 45 日以内）。 */
export const MID_EARNINGS_LAG_DAYS = 45;

export type MidCheckId =
  | "drawdown"
  | "reboundFromLow"
  | "volumeFloor"
  | "marketCap50"
  | "lockupPassed"
  | "growth"
  | "firstEarningsGap";

export interface MidCheckResult {
  id: MidCheckId;
  label: string;
  verdict: CheckpointVerdict;
  /** この銘柄の値（表示用） */
  value: string;
  /** 判定の基準（表示用） */
  threshold: string;
  /** 行に出す短い根拠 */
  short: string;
  /** true なら表示だけで、候補・スコアに使わない */
  displayOnly?: boolean;
}

interface MidCheckInput {
  item: MidItem;
  ipo?: Ipo;
  enriched?: CheckpointEnriched;
  todayIso: string;
}

function pct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function pctNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

function md(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

function sharesJa(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000) / 10}万株` : `${Math.round(n).toLocaleString("ja-JP")}株`;
}

// ------------------------------------------------------------
// 各チェック
// ------------------------------------------------------------

export function checkDrawdown({ item }: MidCheckInput): MidCheckResult {
  const tier = currentTier(item.drawdown);
  const value = pct(item.drawdown);
  const threshold = `上場来高値から −${MID_PASS_TIER}% でクリア／−${MID_WARN_TIER}% は注意`;
  const base = { id: "drawdown" as const, label: "上場来高値からの下落", value, threshold };
  if (tier !== null && tier >= MID_PASS_TIER) {
    return { ...base, verdict: "pass", short: `高値から ${value}` };
  }
  if (tier !== null && tier >= MID_WARN_TIER) {
    return { ...base, verdict: "warn", short: `高値から ${value}（−${MID_PASS_TIER}% 手前）` };
  }
  return { ...base, verdict: "fail", short: `高値から ${value}（対象外）` };
}

export function checkReboundFromLow({ item }: MidCheckInput): MidCheckResult {
  return {
    id: "reboundFromLow",
    label: "上場来安値からの戻り",
    verdict: "unknown",
    value: pct(item.rebound),
    threshold: "表示だけ（反発の確認は検証で効果なし）",
    short: `安値から ${pct(item.rebound)}`,
    displayOnly: true,
  };
}

export function checkVolumeFloor({ item }: MidCheckInput): MidCheckResult {
  const base = {
    id: "volumeFloor" as const,
    label: "20 日平均出来高",
    threshold: `${sharesJa(MID_VOLUME_PASS)}以上でクリア／${sharesJa(MID_VOLUME_MIN)}未満は警戒`,
  };
  const v = item.avgVolume20;
  if (v === null) return { ...base, verdict: "unknown", value: "—", short: "出来高 不明" };
  const value = sharesJa(v);
  if (v >= MID_VOLUME_PASS) return { ...base, verdict: "pass", value, short: `出来高 ${value}/日` };
  if (v >= MID_VOLUME_MIN) return { ...base, verdict: "warn", value, short: `出来高 ${value}/日と少なめ` };
  return { ...base, verdict: "fail", value, short: `出来高 ${value}/日で薄い` };
}

/** いまの時価総額（億円）。発行済株式数 × 分割係数 × 終値。無ければ想定時価総額を値動きで補正。 */
export function currentMarketCapOku(item: MidItem, ipo?: Ipo, enriched?: CheckpointEnriched): number | null {
  const issued = enriched?.issuedShares;
  const factor = ipo ? splitFactor(ipo) : 1;
  if (typeof issued === "number" && issued > 0) return (issued * factor * item.close) / 1e8;
  if (ipo && ipo.marketCap > 0 && typeof ipo.offeringPrice === "number" && ipo.offeringPrice > 0) {
    return (ipo.marketCap * item.close * factor) / ipo.offeringPrice;
  }
  return null;
}

export function checkMarketCap({ item, ipo, enriched }: MidCheckInput): MidCheckResult {
  const base = {
    id: "marketCap50" as const,
    label: "時価総額",
    threshold: `${MID_MARKET_CAP_MIN_OKU}億円以上でクリア（下回っても候補から外さない）`,
  };
  const cap = currentMarketCapOku(item, ipo, enriched);
  if (cap === null) return { ...base, verdict: "unknown", value: "—", short: "時価総額 不明" };
  const value = `${cap >= 100 ? Math.round(cap) : Math.round(cap * 10) / 10}億円`;
  if (cap >= MID_MARKET_CAP_MIN_OKU) return { ...base, verdict: "pass", value, short: `時価総額 ${value}` };
  return { ...base, verdict: "warn", value, short: `時価総額 ${value}と小さめ` };
}

export function checkLockupPassed({ item, ipo, enriched }: MidCheckInput, todayIso: string): MidCheckResult {
  const base = { id: "lockupPassed" as const, label: "ロックアップ" };
  const listing = ipo?.listingDate || item.listingDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing)) {
    return { ...base, verdict: "unknown", value: "—", threshold: "解除済みでクリア", short: "ロック 不明" };
  }
  const holderDays = (enriched?.majorShareholders ?? [])
    .map((h) => h.lockupDays)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const own = ipo && ipo.lockup.days > 0 ? ipo.lockup.days : MID_LOCKUP_DEFAULT_DAYS;
  const days = Math.max(own, ...holderDays);
  const threshold = `上場から ${days} 日経過でクリア`;
  const elapsed = daysBetween(listing, todayIso);
  if (elapsed >= days) {
    return { ...base, verdict: "pass", value: `${days} 日経過`, threshold, short: "ロック解除済み" };
  }
  const left = days - elapsed;
  const releaseDate = addDaysIso(listing, days);
  return {
    ...base,
    verdict: "warn",
    value: `解除まで ${left} 日（${md(releaseDate)}）`,
    threshold,
    short: `ロック解除まで ${left} 日`,
  };
}

export function checkGrowth({ enriched }: MidCheckInput): MidCheckResult {
  const base = {
    id: "growth" as const,
    label: "直近期の業績",
    threshold: `増収 ${MID_GROWTH.revenuePct}%・営業増益 ${MID_GROWTH.profitPct}%・営業利益率 ${MID_GROWTH.marginPct}% 以上`,
  };
  const periods = actualPeriodsNewestFirst(enriched?.financialHistory ?? []);
  if (periods.length < 2) return { ...base, verdict: "unknown", value: "—", short: "業績 不明" };
  const cur = periods[0];
  const prev = periods[1];
  const rev = cur.revenue as number;
  const prevRev = prev.revenue as number;
  const op = cur.operatingProfit as number;
  const prevOp = prev.operatingProfit as number;
  const revGrowth = prevRev > 0 ? (rev / prevRev - 1) * 100 : null;
  const opGrowth = prevOp > 0 ? (op / prevOp - 1) * 100 : null;
  const margin = rev > 0 ? (op / rev) * 100 : null;
  const value = [
    revGrowth === null ? "増収率 —" : `増収 ${pctNum(revGrowth)}`,
    opGrowth === null ? (op > prevOp ? "営業益 改善" : "営業益 —") : `営業益 ${pctNum(opGrowth)}`,
    margin === null ? "利益率 —" : `利益率 ${pctNum(margin)}`,
  ].join("・");
  if (rev < prevRev || op < 0) {
    return { ...base, verdict: "fail", value, short: rev < prevRev ? "直近期 減収" : "直近期 営業赤字" };
  }
  const okRev = revGrowth !== null && revGrowth >= MID_GROWTH.revenuePct;
  // 前期が赤字で黒字化したときは増益率が出せないので、黒字化を増益の基準クリアとみなす。
  const okOp = opGrowth !== null ? opGrowth >= MID_GROWTH.profitPct : prevOp <= 0 && op > 0;
  const okMargin = margin !== null && margin >= MID_GROWTH.marginPct;
  if (okRev && okOp && okMargin) {
    return { ...base, verdict: "pass", value, short: `増収 ${pctNum(revGrowth as number)}・利益率 ${pctNum(margin as number)}` };
  }
  const miss = [!okRev ? "増収率" : null, !okOp ? "増益率" : null, !okMargin ? "利益率" : null]
    .filter(Boolean)
    .join("・");
  return { ...base, verdict: "warn", value, short: `業績 ${miss}が基準未満` };
}

/**
 * 次の決算日の推定（決算期の月から四半期末を出し、その MID_EARNINGS_LAG_DAYS 日後を「ごろまで」とする）。
 * 今日以降で最初の推定日を返す。決算期が読めなければ null。
 */
export function estimateNextEarnings(
  enriched: CheckpointEnriched | undefined,
  todayIso: string,
): string | null {
  const keys = (enriched?.financialHistory ?? [])
    .map((p) => periodSortKey(p.period))
    .filter((k): k is number => k !== null);
  if (keys.length === 0) return null;
  const fyMonth = Math.max(...keys) % 100;
  if (!(fyMonth >= 1 && fyMonth <= 12)) return null;
  const year = Number(todayIso.slice(0, 4));
  // 前年〜翌年の四半期末を順に見て、発表の目安日が今日以降の最初のものを取る。
  const candidates: string[] = [];
  for (let y = year - 1; y <= year + 1; y++) {
    for (let q = 0; q < 4; q++) {
      const m0 = ((fyMonth - 1 + q * 3) % 12) + 1;
      // 月末日: 翌月 1 日の前日
      const next = m0 === 12 ? `${y + 1}-01-01` : `${y}-${String(m0 + 1).padStart(2, "0")}-01`;
      candidates.push(addDaysIso(addDaysIso(next, -1), MID_EARNINGS_LAG_DAYS));
    }
  }
  return candidates.sort().find((d) => d >= todayIso) ?? null;
}

export function checkFirstEarningsGap({ ipo, enriched }: MidCheckInput, todayIso: string): MidCheckResult {
  const base = {
    id: "firstEarningsGap" as const,
    label: "決算まで",
    threshold: `保有の目安（${MID_HOLD_BUSINESS_DAYS} 営業日≒${MID_HOLD_CALENDAR_DAYS} 日）の間に決算が来なければクリア`,
  };
  const known = ipo?.firstEarningsDate;
  const hasKnown = typeof known === "string" && /^\d{4}-\d{2}-\d{2}$/.test(known) && known >= todayIso;
  const date = hasKnown ? (known as string) : estimateNextEarnings(enriched, todayIso);
  if (!date) return { ...base, verdict: "unknown", value: "—", short: "決算日 不明" };
  const days = daysBetween(todayIso, date);
  const tag = hasKnown ? "" : "（推定）";
  const value = hasKnown ? `${md(date)}（${days} 日後）` : `${md(date)} ごろまで${tag}（${days} 日以内）`;
  if (days <= MID_HOLD_CALENDAR_DAYS) {
    return { ...base, verdict: "warn", value, short: `決算 ${md(date)}${tag}をまたぐ` };
  }
  return { ...base, verdict: "pass", value, short: `決算まで ${days} 日${tag}` };
}

/** 全チェック（表示順）。 */
export function runMidChecks(input: MidCheckInput): MidCheckResult[] {
  return [
    checkDrawdown(input),
    checkReboundFromLow(input),
    checkVolumeFloor(input),
    checkMarketCap(input),
    checkLockupPassed(input, input.todayIso),
    checkGrowth(input),
    checkFirstEarningsGap(input, input.todayIso),
  ];
}

// ------------------------------------------------------------
// 並べる
// ------------------------------------------------------------

export interface MidReason {
  id: MidCheckId;
  text: string;
  tone: "good" | "warn" | "bad";
}

export interface MidSecondaryPick {
  item: MidItem;
  ipo?: Ipo;
  checks: MidCheckResult[];
  /** いま届いている一番深い段階 */
  tier: MidTier | null;
  /** 候補（下落率がクリアで、警戒が 1 つも無い） */
  candidate: boolean;
  /** 並べ替えのスコア（クリア 2 点・注意 1 点。表示だけの項目と下落率は数えない） */
  score: number;
  /** 行に出す根拠（最大 3 つ。警戒 → 注意 → クリアの順で拾う） */
  reasons: MidReason[];
  /** −60% の初到達日から今日までの暦日数（未到達は null） */
  daysSincePassHit: number | null;
}

const REASON_TONE = { pass: "good", warn: "warn", fail: "bad" } as const;

/** 行に出す根拠（下落率と表示だけの項目は除く）。 */
export function midReasons(checks: readonly MidCheckResult[], max = 3): MidReason[] {
  const pool = checks.filter((c) => c.id !== "drawdown" && !c.displayOnly && c.verdict !== "unknown");
  const order: CheckpointVerdict[] = ["fail", "warn", "pass"];
  return order
    .flatMap((v) => pool.filter((c) => c.verdict === v))
    .slice(0, max)
    .map((c) => ({ id: c.id, text: c.short, tone: REASON_TONE[c.verdict as "pass" | "warn" | "fail"] }));
}

function scoreOf(checks: readonly MidCheckResult[]): number {
  return checks
    .filter((c) => c.id !== "drawdown" && !c.displayOnly)
    .reduce((s, c) => s + (c.verdict === "pass" ? 2 : c.verdict === "warn" ? 1 : 0), 0);
}

/**
 * midterm.json の各行にチェックを当てて並べる（クライアントで呼ぶ）。
 * 並びは 候補 → それ以外、その中でスコアの高い順 → 下落率の深い順 → コード順。
 * @param ipos 現行データの全銘柄（ロックアップ・決算日・分割係数に使う。無い銘柄は該当項目が不明になる）
 * @param file midterm.json（無ければ空）
 * @param enrichedByCode 補完データ（業績・発行済株式数・大株主のロック）
 * @param todayIso 日本時間の今日
 */
export function rankMidSecondary(
  ipos: readonly Ipo[],
  file: MidFile | null,
  enrichedByCode: Readonly<Record<string, CheckpointEnriched>>,
  todayIso: string,
): MidSecondaryPick[] {
  if (!file) return [];
  const byCode = new Map(ipos.map((ipo) => [ipo.code, ipo]));
  const picks = file.items.map((item): MidSecondaryPick => {
    const ipo = byCode.get(item.code);
    const checks = runMidChecks({ item, ipo, enriched: enrichedByCode[item.code], todayIso });
    const drawdown = checks[0];
    const passHit = item.hits[`${MID_PASS_TIER}`];
    return {
      item,
      ipo,
      checks,
      tier: currentTier(item.drawdown),
      candidate: drawdown.verdict === "pass" && checks.every((c) => c.verdict !== "fail"),
      score: scoreOf(checks),
      reasons: midReasons(checks),
      daysSincePassHit: passHit ? daysBetween(passHit, todayIso) : null,
    };
  });
  return picks.sort(
    (a, b) =>
      Number(b.candidate) - Number(a.candidate) ||
      b.score - a.score ||
      a.item.drawdown - b.item.drawdown ||
      a.item.code.localeCompare(b.item.code),
  );
}
