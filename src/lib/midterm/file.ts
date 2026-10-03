// 中長期セカンダリ（上場後に大きく下げた IPO 銘柄の反発狙い）の日足指標と midterm.json の型・生成・検証。純関数。
// 夜間のデータ更新（scripts/updater/midterm.ts → public/data/midterm.json）と画面の両方から使う。
// scripts（tsx）からも読むため、実行時に読むモジュールは相対パスで import する。
//
// 定義（過去検証 scratch/backtest/midterm_backtest.py と同じ定義。変えるときは検証側と揃える）:
// - 対象: 基準日 asOf（全銘柄の最新の日足の日付）の日足があり、上場日が asOf から 1095 暦日（3 年）以内で、
//   整形後の日足が MID_MIN_BARS 本以上（上場後 5 営業日以降）の銘柄。日足は分割調整済み・現在の単位。
// - 上場来高値 = 日中高値（high）の累積最大。下落率 = 終値 ÷ 上場来高値 − 1。
// - 段階の初到達日 = 下落率が −X% 以下に初めてなった日（上場初日の足は除く）。翌営業日の始値で買うのが検証の前提。
// - 上場来安値 = 日中安値（low）の累積最小。安値からの戻り = 終値 ÷ 上場来安値 − 1（表示だけ。検証で効果なし）。
// - 20 日平均出来高 = 直近 20 本（無ければある分）の出来高の平均（株・現在の単位）。
// - midterm.json に書くのは、いまの下落率が −40% 以下の銘柄だけ（段階表示の最小）。

import { toOhlcBars, type OhlcBar } from "../chart/ohlc";
import { daysBetween } from "../date";
import type { QuotePoint } from "../quote";

/** 上場からの暦日数の上限（3 年。注目度ランキング hot の 1 年とは別の母集団）。 */
export const MID_LISTING_WINDOW_DAYS = 1095;
/** 対象にする日足の最少本数（上場 5 営業日目から）。 */
export const MID_MIN_BARS = 5;
/** 段階（上場来高値からの下落率、%）。 */
export const MID_TIERS = [40, 50, 60] as const;
export type MidTier = (typeof MID_TIERS)[number];
/** midterm.json に書く下落率の上限（−40% 以下だけ書く）。 */
export const MID_FILE_MAX_DRAWDOWN = -0.4;
/** 出来高の平均を取る本数。 */
export const MID_VOLUME_WINDOW = 20;

/** 下落率ちょうど（−0.6 など）の浮動小数の誤差を吸収する幅。 */
const EPSILON = 1e-9;

/** 1 銘柄分の指標（比率は小数。−0.6 = −60%）。 */
export interface MidMetrics {
  bars: number;
  /** 最新の日足の日付 */
  lastDate: string;
  /** 最新の終値（円・現在の単位） */
  close: number;
  /** 上場来高値（円・現在の単位） */
  ath: number;
  athDate: string;
  /** 上場来安値（円・現在の単位） */
  low: number;
  lowDate: string;
  /** 終値 ÷ 上場来高値 − 1 */
  drawdown: number;
  /** 終値 ÷ 上場来安値 − 1 */
  rebound: number;
  /** 直近 20 本の平均出来高（株）。出来高が 1 本も無ければ null */
  avgVolume20: number | null;
  /** 段階ごとの初到達日（未到達は null） */
  hits: Record<`${MidTier}`, string | null>;
}

/** 整形済みの日足（日付昇順）から指標を計算する。1 本も無ければ null。 */
export function computeMidMetrics(bars: readonly OhlcBar[]): MidMetrics | null {
  const n = bars.length;
  if (n === 0) return null;
  let ath = -Infinity;
  let athDate = "";
  let low = Infinity;
  let lowDate = "";
  const hits: MidMetrics["hits"] = { "40": null, "50": null, "60": null };
  bars.forEach((b, i) => {
    if (b.high > ath) {
      ath = b.high;
      athDate = b.date;
    }
    if (b.low < low) {
      low = b.low;
      lowDate = b.date;
    }
    if (i === 0) return; // 上場初日の足では到達とみなさない（検証と同じ）
    const dd = b.close / ath - 1;
    for (const tier of MID_TIERS) {
      const key = `${tier}` as const;
      if (hits[key] === null && dd <= -tier / 100 + EPSILON) hits[key] = b.date;
    }
  });
  const last = bars[n - 1];
  const volumes = bars
    .slice(-MID_VOLUME_WINDOW)
    .map((b) => b.volume)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    bars: n,
    lastDate: last.date,
    close: last.close,
    ath,
    athDate,
    low,
    lowDate,
    drawdown: last.close / ath - 1,
    rebound: last.close / low - 1,
    avgVolume20: volumes.length > 0 ? volumes.reduce((s, v) => s + v, 0) / volumes.length : null,
    hits,
  };
}

/** いまの下落率が届いている一番深い段階（−40% 未満の下げなら null）。 */
export function currentTier(drawdown: number): MidTier | null {
  let tier: MidTier | null = null;
  for (const t of MID_TIERS) if (drawdown <= -t / 100 + EPSILON) tier = t;
  return tier;
}

/** 入力（1 銘柄）。 */
export interface MidCandidate {
  code: string;
  name: string;
  listingDate: string;
  /** 日足（分割調整済み・現在の単位）。整形前でよい（toOhlcBars で整える） */
  quotes: readonly QuotePoint[];
}

/** midterm.json の 1 行。 */
export interface MidItem extends MidMetrics {
  code: string;
  name: string;
  listingDate: string;
}

export interface MidFile {
  /** 基準日（最新の日足の日付）。対象が無ければ空文字 */
  asOf: string;
  /** 生成時刻（ISO） */
  generatedAt: string;
  /** 対象銘柄数（上場 5 営業日〜3 年で基準日の日足がある銘柄） */
  universe: number;
  /** 下落率の深い順（−40% 以下だけ） */
  items: MidItem[];
}

/** 候補の日足から midterm.json の中身を作る。 */
export function buildMidFile(candidates: readonly MidCandidate[], now: Date): MidFile {
  const prepared = candidates.flatMap((c) => {
    const bars = toOhlcBars(c.quotes);
    return bars.length > 0 ? [{ c, bars }] : [];
  });
  const asOf = prepared.reduce((max, p) => {
    const d = p.bars[p.bars.length - 1].date;
    return d > max ? d : max;
  }, "");
  let universe = 0;
  const items: MidItem[] = [];
  for (const { c, bars } of prepared) {
    if (bars[bars.length - 1].date !== asOf) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.listingDate)) continue;
    const age = daysBetween(c.listingDate, asOf);
    if (age < 0 || age > MID_LISTING_WINDOW_DAYS) continue;
    if (bars.length < MID_MIN_BARS) continue;
    const m = computeMidMetrics(bars);
    if (!m) continue;
    universe += 1;
    if (m.drawdown > MID_FILE_MAX_DRAWDOWN + EPSILON) continue;
    items.push({ code: c.code, name: c.name, listingDate: c.listingDate, ...roundMetrics(m) });
  }
  items.sort((a, b) => a.drawdown - b.drawdown || a.code.localeCompare(b.code));
  return { asOf, generatedAt: now.toISOString(), universe, items };
}

function r4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/** ファイルを小さく・差分を安定させるための丸め（比率は小数 4 桁、出来高は整数）。 */
function roundMetrics(m: MidMetrics): MidMetrics {
  return {
    ...m,
    drawdown: r4(m.drawdown),
    rebound: r4(m.rebound),
    avgVolume20: m.avgVolume20 === null ? null : Math.round(m.avgVolume20),
  };
}

// ------------------------------------------------------------
// 読み込み時の検証
// ------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isoOrEmpty(v: unknown): string {
  return typeof v === "string" && ISO_DATE.test(v) ? v : "";
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

function parseItem(raw: unknown): MidItem | null {
  if (!isRecord(raw)) return null;
  const { code, name } = raw;
  const bars = num(raw.bars);
  const close = num(raw.close);
  const ath = num(raw.ath);
  const low = num(raw.low);
  const drawdown = num(raw.drawdown);
  const rebound = num(raw.rebound);
  if (typeof code !== "string" || code === "" || typeof name !== "string") return null;
  if (bars === null || close === null || ath === null || low === null || drawdown === null || rebound === null) {
    return null;
  }
  if (!(close > 0 && ath > 0 && low > 0)) return null;
  const hitsRaw = isRecord(raw.hits) ? raw.hits : {};
  return {
    code,
    name,
    listingDate: isoOrEmpty(raw.listingDate),
    bars: Math.max(1, Math.round(bars)),
    lastDate: isoOrEmpty(raw.lastDate),
    close,
    ath,
    athDate: isoOrEmpty(raw.athDate),
    low,
    lowDate: isoOrEmpty(raw.lowDate),
    drawdown,
    rebound,
    avgVolume20: num(raw.avgVolume20),
    hits: { "40": isoOrNull(hitsRaw["40"]), "50": isoOrNull(hitsRaw["50"]), "60": isoOrNull(hitsRaw["60"]) },
  };
}

/** midterm.json（unknown）を検証して型付きにする。asOf が日付でなければ null。形の崩れた行は落とす。 */
export function parseMidFile(raw: unknown): MidFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(parseItem).filter((x): x is MidItem => x !== null)
    : [];
  const universe = num(raw.universe);
  return {
    asOf,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    universe: universe !== null && universe >= 0 ? Math.round(universe) : items.length,
    items,
  };
}
