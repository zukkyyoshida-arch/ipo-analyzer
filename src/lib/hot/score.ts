// 「いま熱い銘柄」（上場から1年以内の銘柄の注目度ランキング）の純関数。
// 夜間のデータ更新（scripts/updater/hot.ts → public/data/hot.json）と画面の両方から使う。
// scripts（tsx）からも読むため、実行時に読むモジュールは相対パスで import する。
//
// 定義（過去検証 scratch/backtest/hot_backtest.py と同じ定義。変えるときは検証側と揃える）:
// - 対象: 基準日 asOf（最新の日足の日付）から見て上場日が 365 暦日以内の上場済み銘柄で、asOf の日足がある銘柄
//   （検証の「評価日 t はその銘柄の日足が t に存在する日」と同じ。売買停止などで足の無い銘柄は外れる）。
//   日足は分割調整済み・現在の単位。重複日付・出来高 0 の穴埋め行は toOhlcBars で除く。整形後 2 本未満は対象外。
// - 指標（n = 足の本数、末尾が最新）:
//   r5       = close[n-1] / close[n-6] − 1（n-6 < 0 なら bars[0].open を基準＝上場来の騰落率）
//   r20      = close[n-1] / close[n-21] − 1（n-21 < 0 なら bars[0].open を基準＝上場来の騰落率）
//   volRatio = 直近5本の出来高平均 ÷ その直前20本の出来高平均（n < 25 なら null）
//   highProx = close[n-1] ÷ 上場来の最高値（high の最大）
//   turnover5 = 直近5本（無ければある分）の close×volume の平均（円）
// - 流動性の足切り: turnover5 < 3,000万円 は対象外。
// - スコア: 対象銘柄の中でのパーセンタイル順位 p(x)（0〜100、同順位は平均順位、null は 50）で
//   score = round(0.35·p(r5) + 0.25·p(r20) + 0.25·p(volRatio) + 0.15·p(highProx))
//   p(x) = (平均順位 − 1) ÷ (値のある件数 − 1) × 100（最小 0・最大 100。値のある件数が 1 以下なら 50）
//   並びは丸める前のスコアの高い順、同点は証券コードの昇順
// - 理由（最大3つ、この順）: r5 ≥ +10% / volRatio ≥ 2 / highProx ≥ 0.98 / r20 ≥ +20%
//   基準が上場初日の始値のとき（r5 は n < 6、r20 は n < 21）は「5日」「20日」ではなく「上場来」と表示する。
//   n < 6 では r5 と r20 が同じ値になるので、同じ文言のチップは 1 つにする（表示だけで、スコアは変わらない）。
// - 初値倍率（初値 ÷ 公開価格。上場時の単位どうし）は過熱の注意表示に使う（スコアには入れない）。

import { toOhlcBars, type OhlcBar } from "../chart/ohlc";
import { daysBetween } from "../date";
import type { QuotePoint } from "../quote";

/** 上場からの暦日数の上限。 */
export const HOT_LISTING_WINDOW_DAYS = 365;
/** 流動性の足切り（直近5本の平均売買代金、円）。 */
export const HOT_MIN_TURNOVER = 30_000_000;
/** 指標の重み（合計 1）。 */
export const HOT_WEIGHTS = { r5: 0.35, r20: 0.25, volRatio: 0.25, highProx: 0.15 } as const;
/** 理由チップのしきい値。 */
export const HOT_REASON_THRESHOLDS = { r5: 0.1, volRatio: 2, highProx: 0.98, r20: 0.2 } as const;
/** 理由チップの最大数。 */
export const HOT_MAX_REASONS = 3;
/** hot.json に書く件数の上限。 */
export const HOT_FILE_LIMIT = 30;

/** しきい値ちょうど（0.1 など）の浮動小数の誤差を吸収する幅。 */
const EPSILON = 1e-9;

/** 1銘柄分の指標。比率は小数（0.1 = +10%）。 */
export interface HotMetrics {
  /** 日足の本数 n（整形後）。r5・r20 の基準が上場初日の始値かどうかの判定に使う */
  bars: number;
  r5: number;
  r20: number;
  volRatio: number | null;
  highProx: number;
  /** 円 */
  turnover5: number;
}

/** ランキングの入力（1銘柄）。 */
export interface HotCandidate {
  code: string;
  name: string;
  /** 上場日（YYYY-MM-DD） */
  listingDate: string;
  /** 日足（分割調整済み・現在の単位）。整形前でよい（toOhlcBars で整える） */
  quotes: readonly QuotePoint[];
  /** 公開価格（上場時の単位） */
  offeringPrice: number | null;
  /** 初値（上場時の単位）。無ければ最初の取引の始値 × splitFactor で代用する */
  initialPrice: number | null;
  /** 上場日からの累積分割係数（未設定は 1） */
  splitFactor?: number | null;
}

/** ランキングの1行（hot.json の items の1件）。 */
export interface HotItem {
  code: string;
  name: string;
  listingDate: string;
  /** 注目度（0〜100 の整数） */
  score: number;
  r5: number;
  r20: number;
  volRatio: number | null;
  highProx: number;
  turnover5: number;
  /**
   * 日足の本数（整形後）。r5 は 6 本未満、r20 は 21 本未満のとき上場初日の始値が基準（上場来の騰落率）。
   * 古い hot.json には無い（その場合は従来どおりの表示）
   */
  bars?: number;
  /** 初値 ÷ 公開価格（上場時の単位どうし）。どちらかが無ければ null */
  initialRatio: number | null;
  reasons: string[];
}

export interface HotRanking {
  /** 基準日（最新の日足の日付、YYYY-MM-DD）。対象が無ければ空文字 */
  asOf: string;
  /** 足切り後の対象銘柄数（パーセンタイルの母数） */
  universe: number;
  /** 注目度の高い順 */
  items: HotItem[];
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function volumesOf(bars: readonly OhlcBar[]): number[] {
  return bars
    .map((b) => b.volume)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/**
 * k 日の騰落率の基準が上場初日の始値か（足の本数が k + 1 本未満で、k 本前の終値が無い）。
 * 本数が不明（古い hot.json）なら false。
 */
export function isSinceListingReturn(barCount: number | null | undefined, k: number): boolean {
  return typeof barCount === "number" && barCount < k + 1;
}

/** k 本前の終値（足りなければ最初の足の始値）からの騰落率。 */
function returnOver(bars: readonly OhlcBar[], k: number): number {
  const n = bars.length;
  const idx = n - 1 - k;
  const base = idx < 0 ? bars[0].open : bars[idx].close;
  return bars[n - 1].close / base - 1;
}

/**
 * 整形済みの日足（日付昇順）から指標を計算する。2本未満は null。
 */
export function computeHotMetrics(bars: readonly OhlcBar[]): HotMetrics | null {
  const n = bars.length;
  if (n < 2) return null;
  const last = bars[n - 1];

  let volRatio: number | null = null;
  if (n >= 25) {
    const recent = average(volumesOf(bars.slice(n - 5)));
    const before = average(volumesOf(bars.slice(n - 25, n - 5)));
    if (recent !== null && before !== null && before > 0) {
      volRatio = recent / before;
    }
  }

  const maxHigh = bars.reduce((m, b) => Math.max(m, b.high), 0);

  const turnovers = bars
    .slice(Math.max(0, n - 5))
    .filter((b) => typeof b.volume === "number" && Number.isFinite(b.volume))
    .map((b) => b.close * (b.volume as number));

  return {
    bars: n,
    r5: returnOver(bars, 5),
    r20: returnOver(bars, 20),
    volRatio,
    highProx: maxHigh > 0 ? last.close / maxHigh : 0,
    turnover5: average(turnovers) ?? 0,
  };
}

/**
 * パーセンタイル順位（0〜100）。同じ値は平均順位、null・非有限は 50。
 * p = (平均順位 − 1) ÷ (値のある件数 − 1) × 100。値のある件数が 1 以下なら 50。
 */
export function percentileRanks(values: readonly (number | null)[]): number[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v);
  const out = values.map(() => 50);
  const count = present.length;
  if (count <= 1) return out;

  let start = 0;
  while (start < count) {
    let end = start;
    while (end + 1 < count && present[end + 1].v === present[start].v) end++;
    // 順位は 1 始まり。start..end が同じ値なので、その平均順位を全員に付ける。
    const avgRank = (start + 1 + end + 1) / 2;
    const p = ((avgRank - 1) / (count - 1)) * 100;
    for (let k = start; k <= end; k++) out[present[k].i] = p;
    start = end + 1;
  }
  return out;
}

/** 比率（0.123）を「+12%」に。 */
function signedWholePct(ratio: number): string {
  const v = Math.round(ratio * 100);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v)}%`;
}

/**
 * 理由チップ（最大3つ、r5 → 出来高 → 高値圏 → r20 の順）。
 * 基準が上場初日の始値の騰落率は「上場来 +40%」と書く。同じ文言は 1 つだけにする。
 */
export function hotReasons(m: HotMetrics): string[] {
  const t = HOT_REASON_THRESHOLDS;
  const out: string[] = [];
  const add = (chip: string) => {
    if (!out.includes(chip)) out.push(chip);
  };
  if (m.r5 >= t.r5 - EPSILON) {
    add(`${isSinceListingReturn(m.bars, 5) ? "上場来" : "5日"} ${signedWholePct(m.r5)}`);
  }
  if (m.volRatio !== null && m.volRatio >= t.volRatio - EPSILON) {
    add(`出来高 ${m.volRatio.toFixed(1)}倍`);
  }
  if (m.highProx >= t.highProx - EPSILON) add("上場来高値圏");
  if (m.r20 >= t.r20 - EPSILON) {
    add(`${isSinceListingReturn(m.bars, 20) ? "上場来" : "20日"} ${signedWholePct(m.r20)}`);
  }
  return out.slice(0, HOT_MAX_REASONS);
}

/**
 * 初値倍率（初値 ÷ 公開価格。上場時の単位どうし）。
 * 初値が無いときは、整形済み日足の最初の足の始値（現在の単位）× 分割係数で上場時の単位に戻して使う。
 */
export function initialRatioOf(
  candidate: Pick<HotCandidate, "offeringPrice" | "initialPrice" | "splitFactor">,
  bars: readonly OhlcBar[],
): number | null {
  const offering = candidate.offeringPrice;
  if (!isPositiveFinite(offering)) return null;
  let initial: number | null = null;
  if (isPositiveFinite(candidate.initialPrice)) {
    initial = candidate.initialPrice;
  } else if (bars.length > 0) {
    const factor = isPositiveFinite(candidate.splitFactor) ? candidate.splitFactor : 1;
    initial = bars[0].open * factor;
  }
  return initial === null ? null : initial / offering;
}

function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 注目度ランキングを作る。
 * @param options.asOf 基準日。省略時は全銘柄の最終の足の日付の最大。指定時はそれより後の足を使わない（過去時点の再現用）
 * @param options.limit 返す件数（既定 HOT_FILE_LIMIT）
 */
export function buildHotRanking(
  candidates: readonly HotCandidate[],
  options: { asOf?: string; limit?: number } = {},
): HotRanking {
  const limit = options.limit ?? HOT_FILE_LIMIT;
  const cutoff = options.asOf;

  const prepared = candidates
    .map((c) => {
      const all = toOhlcBars(c.quotes);
      const bars = cutoff ? all.filter((b) => b.date <= cutoff) : all;
      return { c, bars };
    })
    .filter((x) => x.bars.length >= 2);

  const asOf =
    cutoff ??
    prepared.reduce((m, x) => {
      const d = x.bars[x.bars.length - 1].date;
      return d > m ? d : m;
    }, "");
  if (!asOf) return { asOf: "", universe: 0, items: [] };

  const universe = prepared.flatMap(({ c, bars }) => {
    if (!ISO_DATE.test(c.listingDate)) return [];
    const sinceListing = daysBetween(c.listingDate, asOf);
    if (sinceListing < 0 || sinceListing > HOT_LISTING_WINDOW_DAYS) return [];
    if (bars[bars.length - 1].date !== asOf) return [];
    const metrics = computeHotMetrics(bars);
    if (!metrics || metrics.turnover5 < HOT_MIN_TURNOVER) return [];
    return [{ c, bars, metrics }];
  });

  const p5 = percentileRanks(universe.map((u) => u.metrics.r5));
  const p20 = percentileRanks(universe.map((u) => u.metrics.r20));
  const pVol = percentileRanks(universe.map((u) => u.metrics.volRatio));
  const pHigh = percentileRanks(universe.map((u) => u.metrics.highProx));
  const w = HOT_WEIGHTS;

  const scored = universe.map((u, i) => {
    const raw = w.r5 * p5[i] + w.r20 * p20[i] + w.volRatio * pVol[i] + w.highProx * pHigh[i];
    const initialRatio = initialRatioOf(u.c, u.bars);
    const item: HotItem = {
      code: u.c.code,
      name: u.c.name,
      listingDate: u.c.listingDate,
      score: Math.round(raw),
      r5: roundTo(u.metrics.r5, 4),
      r20: roundTo(u.metrics.r20, 4),
      volRatio: u.metrics.volRatio === null ? null : roundTo(u.metrics.volRatio, 2),
      highProx: roundTo(u.metrics.highProx, 4),
      turnover5: Math.round(u.metrics.turnover5),
      bars: u.metrics.bars,
      initialRatio: initialRatio === null ? null : roundTo(initialRatio, 3),
      reasons: hotReasons(u.metrics),
    };
    return { raw, item };
  });

  scored.sort((a, b) => b.raw - a.raw || (a.item.code < b.item.code ? -1 : a.item.code > b.item.code ? 1 : 0));

  return {
    asOf,
    universe: universe.length,
    items: scored.slice(0, limit).map((s) => s.item),
  };
}
