import type { Ipo } from "@/types/ipo";

// 株式分割をまたいで価格を比べるための換算ヘルパ（純関数）。
//
// 単位の約束:
// - 上場時の単位: offeringPrice（公開価格）・initialPrice（初値）・initialVolume（初日出来高）。
//   過去の記録であり、初値騰落率などの統計はこの単位で計算する。
// - 現在の単位: currentPrice・recentVolume・/api/quote のライブ値・チャートの日足。
//   実際に売買される値（Yahoo の分割調整済みの値）。
// 両者を比べたり割ったりするときは、必ずここの関数で片方に揃える。
// splitFactor（上場日から今日までの累積分割係数）が未設定・不正値なら 1（分割なし）とみなす。

type WithSplit = Pick<Ipo, "splitFactor">;

/** 累積分割係数。未設定・0以下・非有限は 1。 */
export function splitFactor(ipo: WithSplit): number {
  const f = ipo.splitFactor;
  return typeof f === "number" && Number.isFinite(f) && f > 0 ? f : 1;
}

/** 上場後に株式分割（または併合）があったか。 */
export function hasSplit(ipo: WithSplit): boolean {
  return splitFactor(ipo) !== 1;
}

/** 現在の単位の価格を上場時の単位へ換算する（× 係数）。 */
export function toListingScale(currentPrice: number, ipo: WithSplit): number {
  return currentPrice * splitFactor(ipo);
}

/** 上場時の単位の価格を現在の単位へ換算する（÷ 係数）。 */
export function toCurrentScale(listingPrice: number, ipo: WithSplit): number {
  return listingPrice / splitFactor(ipo);
}

/** 換算した価格の表示用丸め（0.1円単位）。753.333… → 753.3、885.0000001 → 885。 */
export function roundPrice(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 現在値（現在の単位）を上場時の単位に直した値。現在値が無ければ null。
 * 公開価格・初値との比較（公募比・1.5倍ライン・現在値≧初値）に使う。
 */
export function currentPriceAtListingScale(
  ipo: WithSplit & Pick<Ipo, "currentPrice">,
): number | null {
  const current = ipo.currentPrice;
  if (typeof current !== "number" || !Number.isFinite(current)) return null;
  return toListingScale(current, ipo);
}

/**
 * 分割比の表示（例: 係数 6 → "1:6"、係数 1.5 → "2:3"、併合 0.1 → "10:1"）。
 * 分割なしは null。整数比にならない係数は小数2桁で示す。
 */
export function formatSplitRatio(ipo: WithSplit): string | null {
  const f = splitFactor(ipo);
  if (f === 1) return null;
  const [from, to] = f > 1 ? [1, f] : [1 / f, 1];
  // 小さい方を 1〜10 倍して両方が整数になる比を探す（1:1.5 → 2:3）。
  const small = Math.min(from, to);
  for (let k = 1; k <= 10; k++) {
    const a = (from / small) * k;
    const b = (to / small) * k;
    if (isNearInteger(a) && isNearInteger(b)) {
      return `${Math.round(a)}:${Math.round(b)}`;
    }
  }
  return f > 1 ? `1:${f.toFixed(2)}` : `${(1 / f).toFixed(2)}:1`;
}

function isNearInteger(value: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-6;
}
