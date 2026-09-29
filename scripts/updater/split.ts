import { pickInitialQuote, type DailyQuote } from "./initial";

// 株式分割の扱い（純関数）。
//
// Yahoo Finance の日足（chart()）は、株式分割を遡って調整した値を返す。
// 一方、公開価格・初値・初日出来高は「上場時の単位」で持つ約束なので（src/lib/price.ts）、
// 上場日から今日までの分割イベントから累積分割係数（splitFactor）を求め、
// 日足から取った初値・初日出来高を上場時の単位に戻す。
//   初値（上場時の単位）     = 調整済みの始値 × splitFactor
//   初日出来高（上場時の単位）= 調整済みの出来高 ÷ splitFactor

/** chart() の events.splits の1件分（使う項目だけ）。 */
export interface SplitEvent {
  date: Date;
  numerator: number;
  denominator: number;
}

/** 係数の丸め桁（浮動小数の誤差 1.1×3=3.3000000000000003 を消す）。 */
const FACTOR_DIGITS = 1e6;

/**
 * 上場日以降の分割イベントから累積分割係数を計算する（分割なしは 1）。
 * 1:6 分割（numerator=6, denominator=1）なら 6、1:2 のあと 1:3 なら 6。
 * 併合（numerator < denominator）は 1 未満になる。
 * listingDate（YYYY-MM-DD）を渡すと、それより前の日付のイベントは数えない。
 * 分子・分母が正の有限数でないイベントは無視する。
 */
export function cumulativeSplitFactor(
  splits: readonly SplitEvent[],
  listingDate?: string,
): number {
  let factor = 1;
  for (const s of splits) {
    if (listingDate && jstDateOf(s.date) < listingDate) continue;
    if (!isPositive(s.numerator) || !isPositive(s.denominator)) continue;
    factor *= s.numerator / s.denominator;
  }
  return Math.round(factor * FACTOR_DIGITS) / FACTOR_DIGITS;
}

/**
 * 今回取得した係数と前回値から、記録する係数を決める。
 * 範囲は常に上場日〜今日なので、一度数えた分割が消えることはない。
 * 前回 1 以外だったのに今回 1（イベントが返らなかった）ときは取得の不調とみなして前回値を保つ。
 */
export function resolveSplitFactor(previous: number | undefined, fetched: number): number {
  if (!isPositive(fetched)) return isPositive(previous) ? previous : 1;
  if (fetched === 1 && isPositive(previous) && previous !== 1) return previous;
  return fetched;
}

/**
 * 分割調整済みの価格を上場時の単位に戻す（× 係数）。
 * 係数 1 は値をそのまま返す（既存の精度を保つ）。分割ありは 0.1円単位に丸め、
 * Yahoo の単精度由来の誤差（502.79998779296875×5=2513.9999…）を消して円単位の値に戻す。
 */
export function toListingPrice(adjustedPrice: number, factor: number): number {
  if (factor === 1) return adjustedPrice;
  return Math.round(adjustedPrice * factor * 10) / 10;
}

/** 分割調整済みの出来高を上場時の単位に戻す（÷ 係数、株数は整数に丸める）。係数 1 はそのまま。 */
export function toListingVolume(adjustedVolume: number, factor: number): number {
  if (factor === 1) return adjustedVolume;
  return Math.round(adjustedVolume / factor);
}

/** 初値の足（上場時の単位に戻した始値・出来高、調整済みのままの値、その足の日付）。 */
export interface ListingInitialQuote {
  /** 足の日付（YYYY-MM-DD、JST） */
  date: string;
  /** 初値（上場時の単位） */
  initialPrice: number;
  /** 初日出来高（上場時の単位） */
  initialVolume: number;
  /** Yahoo の分割調整済みの始値（現在の単位） */
  adjustedOpen: number;
  /** Yahoo の分割調整済みの出来高（現在の単位） */
  adjustedVolume: number;
}

/**
 * 分割調整済みの日足から初値の足を選び（pickInitialQuote）、上場時の単位に戻して返す。
 * 取引のある足が無ければ undefined。
 */
export function listingInitialQuote<T extends DailyQuote & { date: Date }>(
  quotes: readonly T[],
  factor: number,
): ListingInitialQuote | undefined {
  const first = pickInitialQuote([...quotes]);
  if (!first || first.open === null || first.volume === null) return undefined;
  return {
    date: jstDateOf(first.date),
    initialPrice: toListingPrice(first.open, factor),
    initialVolume: toListingVolume(first.volume, factor),
    adjustedOpen: first.open,
    adjustedVolume: first.volume,
  };
}

/** Date を JST の YYYY-MM-DD にする（Yahoo の日足は JST 9:00 = UTC 0:00 の時刻で返る）。 */
export function jstDateOf(date: Date): string {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** applySplitAndInitial の結果（ログ用）。 */
export interface SplitApplyResult {
  /** 記録した累積分割係数 */
  splitFactor: number;
  /** 初値・初日出来高を書き換えたか */
  initialUpdated: boolean;
  /** 書き換えを見送った理由（あれば） */
  skippedReason?: string;
}

/** applySplitAndInitial が読み書きする auto レコードの項目。 */
export interface SplitTarget {
  initialPrice?: number | null;
  initialVolume?: number | null;
  splitFactor?: number;
}

/** 記録値が Yahoo の調整済みの値と同じとみなす許容差（相対）。分割は 2 倍以上の差になるので十分小さい。 */
const SAME_VALUE_TOLERANCE = 0.005;

function isSameValue(recorded: number | null | undefined, adjusted: number): boolean {
  return (
    typeof recorded === "number" &&
    adjusted > 0 &&
    Math.abs(recorded - adjusted) <= adjusted * SAME_VALUE_TOLERANCE
  );
}

/**
 * 上場日〜今日の日足（分割調整済み）と分割イベントから、auto レコードの splitFactor・
 * initialPrice・initialVolume を更新する。
 *
 * - splitFactor は毎回計算し直す（resolveSplitFactor で取得の不調時は前回値を保つ）。
 * - 初値・初日出来高が未取得なら、日足から取って上場時の単位に戻して入れる。
 * - 取得済みで分割ありなら、記録値が「いまの Yahoo の調整済みの値」と一致するとき
 *   （＝分割後に調整済みの単位で取り込まれた既存データ）だけ、上場時の単位に直す。
 *   一致しない記録値は、分割前に取り込んだ値・手修正の値・修正済みの値なので、上場時の単位とみなして触らない。
 *   日付ではなく値で見るのは、初値持ち越し（338A は上場翌日に初値）でも正しく直すため。
 * - 係数が 1 の銘柄の取得済みの初値・初日出来高には触らない（8303・5537 は手修正済み）。
 */
export function applySplitAndInitial<T extends DailyQuote & { date: Date }>(
  record: SplitTarget,
  quotes: readonly T[],
  splits: readonly SplitEvent[],
  listingDate: string,
): SplitApplyResult {
  const factor = resolveSplitFactor(
    record.splitFactor,
    cumulativeSplitFactor(splits, listingDate),
  );
  record.splitFactor = factor;

  const needsInitial =
    typeof record.initialPrice !== "number" || typeof record.initialVolume !== "number";
  if (!needsInitial && factor === 1) {
    return { splitFactor: factor, initialUpdated: false };
  }

  const initial = listingInitialQuote(quotes, factor);
  if (!initial) {
    return needsInitial
      ? { splitFactor: factor, initialUpdated: false }
      : { splitFactor: factor, initialUpdated: false, skippedReason: "取引のある日足が無い" };
  }

  if (needsInitial) {
    record.initialPrice = initial.initialPrice;
    record.initialVolume = initial.initialVolume;
    return { splitFactor: factor, initialUpdated: true };
  }

  let updated = false;
  if (isSameValue(record.initialPrice, initial.adjustedOpen)) {
    record.initialPrice = initial.initialPrice;
    updated = true;
  }
  if (isSameValue(record.initialVolume, initial.adjustedVolume)) {
    record.initialVolume = initial.initialVolume;
    updated = true;
  }
  return { splitFactor: factor, initialUpdated: updated };
}
