import type { Ipo } from "@/types/ipo";
import type { IpoEnriched } from "@/types/enriched";
import type { HistoricalIpo } from "@/types/history";
import type { CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import type { CheckpointEnriched, CheckpointSummary } from "@/lib/checkpoints/types";
import { runCommonCheckpoints, checkpointChips, type CheckpointChip } from "@/lib/checkpoints/common";
import { instantCashStatus, type InstantCashStatus } from "@/lib/checkpoints/instantCash";
import {
  buildRecentPool,
  forecastInitialPrice,
  isForecastUsable,
} from "@/lib/secondary/initialForecast";
import { ceilTick, floorTick } from "@/lib/secondary/priceLimits";
import { daysBetween, addDaysIso } from "@/lib/date";
import { currentPriceAtListingScale } from "@/lib/price";
import { assessCompleteness } from "@/lib/completeness";

// ホームの「ピックアップ」→「短期セカンダリ」。上場日の前日〜上場後 5 営業日の銘柄に、
// 共通チェック・予想初値のシナリオ・見送り判定・出る目安・買える株数を付ける純関数。
// サーバー（page.tsx）が buildShortSecondaryInputs で対象と予想初値を作り、
// クライアントが rankShortSecondary で設定のしきい値を当てて並べる。

/** 上場日を 1 日目として、ここまでを対象にする。 */
export const SHORT_MAX_DAY = 5;

// ------------------------------------------------------------
// 営業日（土日だけを除く。祝日は見ない）
// ------------------------------------------------------------

export function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

/** iso の前の営業日。 */
export function prevBusinessDay(iso: string): string {
  let d = addDaysIso(iso, -1);
  while (!isWeekday(d)) d = addDaysIso(d, -1);
  return d;
}

/**
 * 上場 N 日目（上場日 = 1）。todayIso が上場日より前なら null。
 * 土日の today は直前の営業日として数える。
 */
export function listingDayNumber(listingDate: string, todayIso: string): number | null {
  if (!listingDate || todayIso < listingDate) return null;
  let n = 0;
  let d = listingDate;
  while (d <= todayIso) {
    if (isWeekday(d)) n += 1;
    d = addDaysIso(d, 1);
  }
  return Math.max(n, 1);
}

/** 段階。eve=上場前日（前の営業日）／day=上場 N 日目。対象外は null。 */
export type ShortStage = { kind: "eve" } | { kind: "day"; n: number };

export function shortStage(listingDate: string, todayIso: string): ShortStage | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listingDate)) return null;
  if (todayIso < listingDate) {
    return prevBusinessDay(listingDate) <= todayIso ? { kind: "eve" } : null;
  }
  const n = listingDayNumber(listingDate, todayIso);
  return n !== null && n <= SHORT_MAX_DAY ? { kind: "day", n } : null;
}

// ------------------------------------------------------------
// サーバーで作る材料
// ------------------------------------------------------------

/** 予想初値（円・上場時の単位）。 */
export interface ShortForecast {
  center: number;
  low80: number;
  high80: number;
  /** 予想初値 ÷ 公開価格 */
  ratio: number;
}

export interface ShortSecondaryInput {
  code: string;
  forecast: ShortForecast | null;
}

/**
 * 対象と予想初値を作る（サーバーで呼ぶ。履歴はクライアントへ渡さない）。
 * 対象は上場前日〜上場 5 日目で、公開価格か吸収金額の少なくとも一方が分かっている銘柄。
 * @param ipos 現行データの全銘柄
 * @param history 2015〜2023 年の履歴（直近の初値騰落の母集団）
 * @param enriched 補完データ（VC 比率・黒字かの判定に使う）
 * @param todayIso 日本時間の今日
 */
export function buildShortSecondaryInputs(
  ipos: Ipo[],
  history: readonly HistoricalIpo[],
  enriched: readonly IpoEnriched[],
  todayIso: string,
): ShortSecondaryInput[] {
  // 公開価格も吸収金額も無い銘柄（テクニカル上場など、判定材料がほぼ無いもの）は外す。
  const targets = ipos.filter(
    (ipo) =>
      shortStage(ipo.listingDate, todayIso) !== null &&
      assessCompleteness(ipo).level !== "insufficient",
  );
  if (targets.length === 0) return [];
  const pool = buildRecentPool(ipos, history);
  const byCode = new Map(enriched.map((e) => [e.code, e]));
  return targets.map((ipo) => {
    const f = forecastInitialPrice(ipo, pool, byCode.get(ipo.code));
    return {
      code: ipo.code,
      forecast: isForecastUsable(f)
        ? { center: f.centerPrice, low80: f.range80.low, high80: f.range80.high, ratio: f.ratioToOffering }
        : null,
    };
  });
}

// ------------------------------------------------------------
// クライアントで当てる判定
// ------------------------------------------------------------

export type ShortDecisionKind = "skip" | "entry" | "wait";

export interface ShortDecision {
  kind: ShortDecisionKind;
  text: string;
}

/**
 * 見送り・入る目安の判定。
 * 初値が付いた銘柄は資料の見送り条件（公募割れ・微上昇・公開価格の +300% 超）を先に見る。
 * そのあと、いまの値段（現在値 → 初値）を予想初値の「入る上限」「見送り」と比べる。
 */
export function shortDecision(
  ipo: Ipo,
  stage: ShortStage,
  forecast: ShortForecast | null,
  t: CheckpointThresholds,
): ShortDecision {
  const offer = ipo.offeringPrice;
  const initial = ipo.initialPrice;
  if (stage.kind === "day" && typeof initial === "number" && initial > 0 && typeof offer === "number" && offer > 0) {
    const ratio = initial / offer;
    if (ratio <= 1) return { kind: "skip", text: "見送り（公募割れ）" };
    if (ratio < 1.05) return { kind: "skip", text: "見送り（初値が公募の +5% 未満）" };
    if (ratio > 1 + t.skipAboveOfferingPct / 100) {
      return { kind: "skip", text: `見送り（初値が公募の +${t.skipAboveOfferingPct}% 超）` };
    }
  }
  if (stage.kind === "eve" && forecast && forecast.ratio > 1 + t.skipAboveOfferingPct / 100) {
    return { kind: "skip", text: `見送り（予想初値が公募の +${t.skipAboveOfferingPct}% 超）` };
  }
  const price = stage.kind === "day" ? priceNowAtListingScale(ipo) : null;
  if (price !== null && forecast) {
    if (price <= forecast.center * t.entryBelowForecastRatio) return { kind: "entry", text: "入る目安内" };
    if (price >= forecast.center * t.skipAboveForecastRatio) return { kind: "skip", text: "見送り（予想初値より高すぎ）" };
    return { kind: "wait", text: "様子見" };
  }
  return { kind: "wait", text: stage.kind === "eve" ? "明日上場" : "初値待ち" };
}

/** いまの値段（上場時の単位）。現在値 → 初値の順。 */
function priceNowAtListingScale(ipo: Ipo): number | null {
  const cur = currentPriceAtListingScale(ipo);
  if (cur !== null && cur > 0) return cur;
  return typeof ipo.initialPrice === "number" && ipo.initialPrice > 0 ? ipo.initialPrice : null;
}

export interface ShortExits {
  /** 基準（初値 or 予想初値） */
  base: number;
  baseLabel: "初値" | "予想初値";
  takeProfitSmall: number;
  takeProfit: number;
  stopLoss: number;
}

/** 出る目安（利確 2%・10%、損切り 10%）を円で。初値があれば初値、無ければ予想初値から。 */
export function shortExits(
  ipo: Ipo,
  forecast: ShortForecast | null,
  t: CheckpointThresholds,
): ShortExits | null {
  const hasInitial = typeof ipo.initialPrice === "number" && ipo.initialPrice > 0;
  const base = hasInitial ? (ipo.initialPrice as number) : forecast?.center ?? null;
  if (base === null || !(base > 0)) return null;
  return {
    base,
    baseLabel: hasInitial ? "初値" : "予想初値",
    takeProfitSmall: ceilTick(base * (1 + t.takeProfitPctSmall / 100)),
    takeProfit: ceilTick(base * (1 + t.takeProfitPct / 100)),
    stopLoss: floorTick(base * (1 - t.stopLossPct / 100)),
  };
}

export interface ShareSizing {
  /** 計算に使った値段（円） */
  price: number;
  /** 買える株数（100 株単位） */
  shares: number;
  /** 株数 × 値段（円） */
  amount: number;
}

/** 資金から買える株数（投入資金 × 1 銘柄の上限 ÷ 値段、100 株単位で切り捨て）。 */
export function shareSizing(price: number | null, t: CheckpointThresholds): ShareSizing | null {
  if (price === null || !(price > 0)) return null;
  const budget = (t.capitalYen * t.maxPerStockPct) / 100;
  const shares = Math.floor(budget / price / 100) * 100;
  return { price, shares, amount: shares * price };
}

/** 画面の 1 行。 */
export interface ShortSecondaryPick {
  ipo: Ipo;
  stage: ShortStage;
  checks: CheckpointSummary;
  chips: CheckpointChip[];
  forecast: ShortForecast | null;
  /** 入る上限（予想初値 × entryBelowForecastRatio） */
  entryMax: number | null;
  /** 見送り（予想初値 × skipAboveForecastRatio 以上） */
  skipAbove: number | null;
  decision: ShortDecision;
  exits: ShortExits | null;
  instantCash: InstantCashStatus;
  sizing: ShareSizing | null;
  /** 上場からの注記（上場後だけ） */
  note: string | null;
}

/**
 * 材料にしきい値を当てて並べる（クライアントで呼ぶ）。
 * 並びは共通チェックの pass 数の多い順 → 上場日が今日に近い順 → コード順。
 */
export function rankShortSecondary(
  ipos: Ipo[],
  inputs: readonly ShortSecondaryInput[],
  enrichedByCode: Readonly<Record<string, CheckpointEnriched>>,
  thresholds: CheckpointThresholds,
  todayIso: string,
): ShortSecondaryPick[] {
  const byCode = new Map(ipos.map((ipo) => [ipo.code, ipo]));
  const picks: ShortSecondaryPick[] = [];
  for (const input of inputs) {
    const ipo = byCode.get(input.code);
    if (!ipo) continue;
    const stage = shortStage(ipo.listingDate, todayIso);
    if (stage === null) continue;
    const t = thresholds;
    const checks = runCommonCheckpoints({ ipo, enriched: enrichedByCode[ipo.code] }, t);
    const f = input.forecast;
    const entryMax = f ? floorTick(f.center * t.entryBelowForecastRatio) : null;
    const skipAbove = f ? ceilTick(f.center * t.skipAboveForecastRatio) : null;
    const dayN = stage.kind === "day" ? stage.n : null;
    const nowPrice =
      stage.kind === "day"
        ? (typeof ipo.currentPrice === "number" && ipo.currentPrice > 0 ? ipo.currentPrice : null) ??
          (typeof ipo.initialPrice === "number" && ipo.initialPrice > 0 ? ipo.initialPrice : null)
        : null;
    picks.push({
      ipo,
      stage,
      checks,
      chips: checkpointChips(checks.items),
      forecast: f,
      entryMax,
      skipAbove,
      decision: shortDecision(ipo, stage, f, t),
      exits: shortExits(ipo, f, t),
      instantCash: instantCashStatus(f?.ratio ?? null, ipo, dayN, t.instantCashRegulationRatio),
      sizing: shareSizing(nowPrice ?? entryMax ?? ipo.offeringPrice, t),
      note: dayN !== null ? `上場 5 日以内は天井になりやすい（あと ${SHORT_MAX_DAY - dayN} 日）` : null,
    });
  }
  return picks.sort(
    (a, b) =>
      b.checks.counts.pass - a.checks.counts.pass ||
      Math.abs(daysBetween(todayIso, a.ipo.listingDate)) - Math.abs(daysBetween(todayIso, b.ipo.listingDate)) ||
      a.ipo.code.localeCompare(b.ipo.code),
  );
}
