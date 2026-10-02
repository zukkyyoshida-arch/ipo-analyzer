import { percentileRanks, YUTAI_MIN_CANDLES, YUTAI_HIT_LINE } from "@/lib/picks/yutai";
import type { YutaiBasketResult, YutaiBasketStat, YutaiBasketYear, YutaiItem, YutaiRightsYear } from "./types";

// 「毎年、総合評価の上位 N 銘柄を均等買い」したバスケットの過去成績（先回り買い: 前月初に買い、権利付最終日に売る）。
// 年 Y の順位付けは、その年より前（year < Y）の日足の成績だけで行う（先読みバイアスを避ける）。
// 総合評価の作り方は src/lib/picks/yutai.ts の rankYutai と同じ（5 指標のパーセンタイル順位の平均）。

/** バスケットを計算する銘柄数（上位 N）。 */
export const YUTAI_BASKET_TOP_NS = [3, 5] as const;

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** 年 Y の買い開始時点で分かっていた成績（year < Y の年だけ）の 5 指標。5 年に満たなければ null。 */
function priorMetrics(years: YutaiRightsYear[], y: number): (number | null)[] | null {
  const prior = years.filter((r) => r.year < y && r.year >= y - 10);
  if (prior.length < YUTAI_MIN_CANDLES) return null;
  const recent = prior.filter((r) => r.year >= y - 5);
  return [
    prior.filter((r) => r.ret > 0).length / prior.length,
    recent.length > 0 ? recent.filter((r) => r.ret > 0).length / recent.length : 0,
    mean(prior.map((r) => r.ret)),
    mean(prior.map((r) => r.maxHighRet)),
    prior.filter((r) => r.maxHighRet >= YUTAI_HIT_LINE - 1e-9).length / prior.length,
  ];
}

/** 1 年ぶん: 過去データだけで総合評価を付け、上位 topN を均等買いした年リターン。 */
export function basketYear(items: YutaiItem[], year: number, topN: number): YutaiBasketYear {
  const cands = items.flatMap((it) => {
    const ys = it.rights?.years;
    if (!ys) return [];
    const m = priorMetrics(ys, year);
    return m ? [{ code: it.code, m, ret: ys.find((r) => r.year === year)?.ret ?? null }] : [];
  });
  const ranks = [0, 1, 2, 3, 4].map((k) => percentileRanks(cands.map((c) => c.m[k])));
  const scored = cands
    .map((c, i) => ({ ...c, score: ranks.reduce((s, r) => s + r[i], 0) / 5 }))
    .sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  // その年の成績が取れた銘柄だけが買えた扱い（上位 topN のうち取れなかった分は平均に入れない）
  const bought = scored.slice(0, topN).filter((c): c is typeof c & { ret: number } => c.ret !== null);
  return {
    year,
    ret: bought.length > 0 ? mean(bought.map((c) => c.ret)) : null,
    n: bought.length,
    codes: bought.map((c) => c.code),
  };
}

/** 年リターンの列から集計（年数・勝ち年数・平均・最大ドローダウン・最良／最悪年）。 */
export function summarizeBasket(topN: number, years: YutaiBasketYear[]): YutaiBasketStat {
  const done = years.filter((y): y is YutaiBasketYear & { ret: number } => y.ret !== null);
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  for (const y of done) {
    eq *= 1 + y.ret;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq / peak - 1);
  }
  const best = done.length > 0 ? done.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
  const worst = done.length > 0 ? done.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
  return {
    topN,
    years,
    n: done.length,
    wins: done.filter((y) => y.ret > 0).length,
    avgRet: done.length > 0 ? mean(done.map((y) => y.ret)) : null,
    maxDrawdown: done.length > 0 ? maxDd : null,
    best: best ? { year: best.year, ret: best.ret } : null,
    worst: worst ? { year: worst.year, ret: worst.ret } : null,
  };
}

/** 毎年の上位 N 銘柄バスケットの成績。topN を渡せばその 1 通り、省略すれば 3 と 5 の 2 通り。 */
export function basketBacktest(items: YutaiItem[], opts: { topN?: number; years: number[] }): YutaiBasketResult {
  const years = [...opts.years].sort((a, b) => a - b);
  const byTopN: Record<string, YutaiBasketStat> = {};
  for (const n of opts.topN !== undefined ? [opts.topN] : YUTAI_BASKET_TOP_NS) {
    byTopN[String(n)] = summarizeBasket(n, years.map((y) => basketYear(items, y, n)));
  }
  return { byTopN };
}
