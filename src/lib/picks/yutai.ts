import type { YutaiItem, YutaiMonth } from "@/lib/yutai/types";

// ホームの「ピックアップ」→「優待」。権利確定月 M の優待銘柄を、前月の月足の指標で順位付けする純関数。
// 手法: 前月の月初に買い、権利付最終日までの値上がりを狙う（過去の傾向であり、検証では予測力は未確認）。
// 足切り（強・良などの区分）はせず、総合評価か指標ひとつで全銘柄を並べる。

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
  /**
   * 総合評価（0〜100 の整数）。月足が YUTAI_MIN_CANDLES 本以上の銘柄の中で、
   * 10 年勝率・直近 5 年勝率・前月平均・最大上昇平均のパーセンタイル順位（0〜1）を平均して 100 倍したもの。
   * 月足が足りない銘柄（データ不足）は null。
   */
  score: number | null;
  /** score の丸める前の値（0〜1）。同点の判定に使う。データ不足は null */
  scoreRaw: number | null;
  reasons: YutaiReason[];
}

/** 月足がこの本数に満たないと、割合が偶然で動くので「データ不足」として総合評価を出さず最後に回す。 */
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
    out.push({ id: "short", text: `データ不足（月足${item.n10}本・上場が浅い）`, tone: "warn" });
  }
  return out;
}

/**
 * values のそれぞれのパーセンタイル順位（0〜1、大きいほど上位）。同値は順位の平均。null は最下位扱い。
 * 1 件だけなら 1。
 */
export function percentileRanks(values: (number | null)[]): number[] {
  const m = values.length;
  if (m === 0) return [];
  if (m === 1) return [1];
  const v = values.map((x) => (x === null || !Number.isFinite(x) ? -Infinity : x));
  const order = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(m);
  for (let s = 0; s < m; ) {
    let e = s;
    while (e + 1 < m && order[e + 1].x === order[s].x) e++;
    const avgRank = (s + e) / 2; // 0 始まりの昇順の順位の平均
    for (let k = s; k <= e; k++) out[order[k].i] = avgRank / (m - 1);
    s = e + 1;
  }
  return out;
}

/** 並べ替えの基準。総合／10年の勝率／直近5年の勝利数／前月平均／最大上昇の平均／最低投資額。 */
export type YutaiSortKey = "score" | "rate10" | "wins5" | "avgRet" | "highRet" | "minInvest";

/** 並べ替えの選択肢（画面の表示順）。 */
export const YUTAI_SORT_OPTIONS: { value: YutaiSortKey; label: string }[] = [
  { value: "score", label: "総合" },
  { value: "rate10", label: "10年の勝率" },
  { value: "wins5", label: "直近5年の勝利数" },
  { value: "avgRet", label: "前月平均" },
  { value: "highRet", label: "最大上昇の平均" },
  { value: "minInvest", label: "最低投資額" },
];

/** localStorage などの値を並べ替えの基準に直す（知らない値・以前の値は総合）。 */
export function parseYutaiSortKey(raw: unknown): YutaiSortKey {
  return YUTAI_SORT_OPTIONS.some((o) => o.value === raw) ? (raw as YutaiSortKey) : "score";
}

const desc = (a: number | null, b: number | null): number => (b ?? -Infinity) - (a ?? -Infinity) || 0;
const short = (p: YutaiPick): number => (p.item.n10 < YUTAI_MIN_CANDLES ? 1 : 0);

/** 総合の順: データ不足は最後 → 総合点（丸める前）→ 10 年勝率 → 前月平均 → コード。 */
const byScore = (a: YutaiPick, b: YutaiPick): number =>
  short(a) - short(b) ||
  desc(a.scoreRaw, b.scoreRaw) ||
  b.upRate10 - a.upRate10 ||
  desc(a.item.avgRet10, b.item.avgRet10) ||
  a.item.code.localeCompare(b.item.code);

/**
 * 銘柄を指定の基準で並べ替える（元の配列は変えない）。
 * - score: 総合評価の降順。データ不足（月足 5 本未満）は常に最後
 * - rate10: 10 年の陽線率 → 直近 5 年の陽線数、wins5: 直近 5 年の陽線数 → 10 年の陽線率、
 *   avgRet: 前月平均、highRet: 最大上昇の平均（いずれも降順・null は後ろ）。データ不足は最後
 * - minInvest: 最低投資額の昇順（不明は最後）
 * 同順位はどれも総合の順で決める。
 */
export function sortYutai(picks: YutaiPick[], key: YutaiSortKey): YutaiPick[] {
  const out = [...picks];
  switch (key) {
    case "rate10":
      return out.sort((a, b) => short(a) - short(b) || b.upRate10 - a.upRate10 || b.item.up5 - a.item.up5 || byScore(a, b));
    case "wins5":
      return out.sort((a, b) => short(a) - short(b) || b.item.up5 - a.item.up5 || b.upRate10 - a.upRate10 || byScore(a, b));
    case "avgRet":
      return out.sort((a, b) => short(a) - short(b) || desc(a.item.avgRet10, b.item.avgRet10) || byScore(a, b));
    case "highRet":
      return out.sort((a, b) => short(a) - short(b) || desc(a.item.avgHighRet10, b.item.avgHighRet10) || byScore(a, b));
    case "minInvest":
      return out.sort((a, b) => {
        if (a.item.minInvest === null || b.item.minInvest === null) {
          return (a.item.minInvest === null ? 1 : 0) - (b.item.minInvest === null ? 1 : 0) || byScore(a, b);
        }
        return a.item.minInvest - b.item.minInvest || byScore(a, b);
      });
    default:
      return out.sort(byScore);
  }
}

/**
 * 権利確定月 1 つぶんの優待銘柄に総合評価を付け、総合の順に並べる。
 * 総合評価の母集団は「月足が 5 本以上の銘柄」（予算で絞る前の月全体）。
 * month が null のときは空配列。
 */
export function rankYutai(month: YutaiMonth | null): YutaiPick[] {
  const items = month?.items ?? [];
  const base = items.map((item) => {
    const pos = pricePos12(item);
    return {
      item,
      upRate10: item.n10 > 0 ? item.up10 / item.n10 : 0,
      upRate5: item.n5 > 0 ? item.up5 / item.n5 : 0,
      pricePos12: pos,
      lastRange: lastRangeOf(item.candles),
      reasons: reasonsOf(item, pos),
    };
  });

  const eligible = base.filter((p) => p.item.n10 >= YUTAI_MIN_CANDLES);
  const metrics: ((p: (typeof base)[number]) => number | null)[] = [
    (p) => p.upRate10,
    (p) => p.upRate5,
    (p) => p.item.avgRet10,
    (p) => p.item.avgHighRet10,
  ];
  const ranks = metrics.map((f) => percentileRanks(eligible.map(f)));
  const raw = new Map<string, number>();
  eligible.forEach((p, i) => raw.set(p.item.code, ranks.reduce((s, r) => s + r[i], 0) / metrics.length));

  const picks = base.map((p): YutaiPick => {
    const scoreRaw = raw.get(p.item.code) ?? null;
    return { ...p, scoreRaw, score: scoreRaw === null ? null : Math.round(scoreRaw * 100) };
  });
  return sortYutai(picks, "score");
}
