import type { YutaiItem, YutaiMonth } from "@/lib/yutai/types";

// ホームの「ピックアップ」→「優待」。権利確定月 M の優待銘柄を、前月の月足の陽線率で並べる純関数。
// 手法: 前月の月初に買い、権利付最終日までの値上がりを狙う（過去の傾向であり、検証では予測力は未確認）。

/** 強（直近5年で4勝以上 かつ 10年で8本以上・70% 以上）／良（直近5年で3勝以上 かつ 10年で60% 以上）／それ以外。 */
export type YutaiTier = "strong" | "good" | "other";

export type YutaiReasonTone = "good" | "warn" | "bad";

export interface YutaiReason {
  id: string;
  text: string;
  tone: YutaiReasonTone;
}

export interface YutaiPick {
  item: YutaiItem;
  /** 直近 10 年の陽線率（n10 が 0 なら 0） */
  upRate10: number;
  /** 直近 5 年の陽線率（n5 が 0 なら 0） */
  upRate5: number;
  /** 直近 12 ヶ月の高安レンジの中での株価位置（0〜1）。取れなければ null */
  pricePos12: number | null;
  /** 前年（月足の最後の 1 本）の安値から高値までの上昇率（0.25 = +25%）。高安が欠けるか安値が 0 以下・月足なしなら null */
  lastRange: number | null;
  tier: YutaiTier;
  reasons: YutaiReason[];
}

export interface TierRule {
  minN5: number;
  minUp5: number;
  minN10: number;
  minRate10: number;
}

export interface RankYutaiOptions {
  /** 強の下限（既定: 直近5年 4/5 以上、10 年 8 本中 70% 以上） */
  strong?: TierRule;
  /** 良の下限（既定: 直近5年 3/4 以上、10 年 60% 以上） */
  good?: TierRule;
}

const DEFAULT_STRONG: TierRule = { minN5: 5, minUp5: 4, minN10: 8, minRate10: 0.7 };
const DEFAULT_GOOD: TierRule = { minN5: 4, minUp5: 3, minN10: 0, minRate10: 0.6 };
/** 月足がこの本数に満たないと、割合が偶然で動くので other にする。 */
export const YUTAI_MIN_CANDLES = 5;
/** 株価位置の高値圏・安値圏のライン。 */
const HIGH_ZONE = 0.85;
const LOW_ZONE = 0.15;

/** 株価位置（0〜1）。高安が逆転・同値・欠損なら null。 */
export function pricePos12(item: Pick<YutaiItem, "price" | "high12" | "low12">): number | null {
  const { price, high12, low12 } = item;
  if (price === null || high12 === null || low12 === null || high12 <= low12) return null;
  return Math.min(1, Math.max(0, (price - low12) / (high12 - low12)));
}

/** 月足の最後の 1 本（最も新しい年＝前年）の「高値 / 安値 − 1」。取れなければ null。 */
export function lastRangeOf(candles: YutaiItem["candles"]): number | null {
  const last = candles[candles.length - 1];
  if (!last || last.high === null || last.low === null || last.low <= 0) return null;
  return last.high / last.low - 1;
}

function signedPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function reasonsOf(item: YutaiItem, pos: number | null): YutaiReason[] {
  const out: YutaiReason[] = [];
  if (item.n10 >= YUTAI_MIN_CANDLES) {
    out.push({ id: "up10", text: `${item.n10}年で${item.up10}勝`, tone: "good" });
  }
  if (item.n5 >= 3) {
    out.push({ id: "up5", text: `直近5年 ${item.up5}勝`, tone: item.up5 >= 4 ? "good" : "warn" });
  }
  if (item.avgRet10 !== null && item.avgRet10 > 0) {
    out.push({ id: "avg", text: `前月平均 ${signedPct(item.avgRet10)}`, tone: "good" });
  }
  if (pos !== null && pos >= HIGH_ZONE) {
    out.push({ id: "high", text: `年高値圏（株価位置 ${Math.round(pos * 100)}%）`, tone: "good" });
  }
  if (pos !== null && pos <= LOW_ZONE) {
    out.push({ id: "low", text: `年安値圏（株価位置 ${Math.round(pos * 100)}%）`, tone: "warn" });
  }
  if (item.n10 < YUTAI_MIN_CANDLES) {
    out.push({ id: "short", text: `月足が${YUTAI_MIN_CANDLES}本未満（上場が浅い）`, tone: "warn" });
  }
  return out;
}

/** 並べ替えの基準。勝利数／勝率／前年の値幅／最低投資額。 */
export type YutaiSortKey = "wins" | "rate" | "range" | "minInvest";

/** 並べ替えの選択肢（画面の表示順）。 */
export const YUTAI_SORT_OPTIONS: { value: YutaiSortKey; label: string }[] = [
  { value: "wins", label: "勝利数" },
  { value: "rate", label: "勝率" },
  { value: "range", label: "前年の値幅" },
  { value: "minInvest", label: "最低投資額" },
];

const byWins = (a: YutaiPick, b: YutaiPick): number =>
  b.item.up5 - a.item.up5 ||
  b.upRate10 - a.upRate10 ||
  b.item.up10 - a.item.up10 ||
  (b.item.avgRet10 ?? -Infinity) - (a.item.avgRet10 ?? -Infinity);

const byRate = (a: YutaiPick, b: YutaiPick): number =>
  b.upRate10 - a.upRate10 ||
  b.upRate5 - a.upRate5 ||
  b.item.up10 - a.item.up10 ||
  (b.item.avgRet10 ?? -Infinity) - (a.item.avgRet10 ?? -Infinity);

/**
 * 銘柄を指定の基準で並べ替える（元の配列は変えない）。
 * wins: 直近 5 年の陽線数 → 10 年の陽線率 → 10 年の陽線数 → 前月平均（降順）。
 * rate: 10 年の陽線率 → 直近 5 年の陽線率 → 10 年の陽線数 → 前月平均（降順）。月足が少ない銘柄は後ろ。
 * range: 前年の値幅の降順（取れない銘柄は最後）。minInvest: 最低投資額の昇順（不明は最後）。
 * range・minInvest の同値は wins の順。
 */
export function sortYutai(picks: YutaiPick[], key: YutaiSortKey): YutaiPick[] {
  const out = [...picks];
  switch (key) {
    case "rate":
      return out.sort((a, b) => {
        const sa = a.item.n10 < YUTAI_MIN_CANDLES ? 1 : 0;
        const sb = b.item.n10 < YUTAI_MIN_CANDLES ? 1 : 0;
        return sa - sb || byRate(a, b);
      });
    case "range":
      return out.sort((a, b) => {
        if (a.lastRange === null || b.lastRange === null) {
          return (a.lastRange === null ? 1 : 0) - (b.lastRange === null ? 1 : 0) || byWins(a, b);
        }
        return b.lastRange - a.lastRange || byWins(a, b);
      });
    case "minInvest":
      return out.sort((a, b) => {
        if (a.item.minInvest === null || b.item.minInvest === null) {
          return (a.item.minInvest === null ? 1 : 0) - (b.item.minInvest === null ? 1 : 0) || byWins(a, b);
        }
        return a.item.minInvest - b.item.minInvest || byWins(a, b);
      });
    default:
      return out.sort(byWins);
  }
}

/**
 * 権利確定月 1 つぶんの優待銘柄を、前月の陽線率の高い順に並べる。
 * 並び: 直近 5 年の陽線数 → 10 年の陽線率 → 10 年の陽線数 → 前月平均騰落率（すべて降順）。
 * month が null のときは空配列。
 */
export function rankYutai(month: YutaiMonth | null, opts: RankYutaiOptions = {}): YutaiPick[] {
  const items = month?.items ?? [];
  const strong = opts.strong ?? DEFAULT_STRONG;
  const good = opts.good ?? DEFAULT_GOOD;

  const picks = items.map((item): YutaiPick => {
    const upRate10 = item.n10 > 0 ? item.up10 / item.n10 : 0;
    const upRate5 = item.n5 > 0 ? item.up5 / item.n5 : 0;
    const pos = pricePos12(item);
    const meets = (r: TierRule) =>
      item.n10 >= YUTAI_MIN_CANDLES &&
      item.n5 >= r.minN5 &&
      item.up5 >= r.minUp5 &&
      item.n10 >= r.minN10 &&
      upRate10 >= r.minRate10;
    const tier: YutaiTier = meets(strong) ? "strong" : meets(good) ? "good" : "other";
    return { item, upRate10, upRate5, pricePos12: pos, lastRange: lastRangeOf(item.candles), tier, reasons: reasonsOf(item, pos) };
  });

  return sortYutai(picks, "wins");
}
