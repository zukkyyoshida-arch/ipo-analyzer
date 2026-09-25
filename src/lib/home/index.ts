import type { Ipo } from "@/types/ipo";
import type { CompletenessResult } from "@/lib/completeness";
import { initialReturnRate } from "@/lib/format";

// ホーム画面（Market Radar）向けの純関数群。テスト対象。
// Date.now は呼ばない。「今日」は呼び出し側（page.tsx）が todayIso として渡す。

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export interface HomeKpis {
  /** 対象銘柄数（全銘柄）。 */
  totalCount: number;
  /** 直近90日: listingDate が today-90日〜today の listed 銘柄。 */
  recentListedCount: number;
  /** 直近90日の初値騰落率の平均（%）。対象が0件、または全件データ不足なら null。 */
  avgInitialReturnRate: number | null;
  /** 初値騰落率平均・公募割れ率の母数（公開価格と初値が両方ある直近90日上場銘柄の数）。 */
  initialReturnSampleCount: number;
  /** 直近90日の公募割れ率（%）。initialPrice < offeringPrice の割合。対象0件なら null。 */
  breakEvenRate: number | null;
  /** 直近90日のトップパフォーマー（詳細は下記 TopPerformer）。対象なしなら null。 */
  topPerformer: TopPerformer | null;
}

export interface TopPerformer {
  ipo: Ipo;
  /** 採用した指標。initialReturnRate があればそれを優先し、無ければ現在値/初値の変化率を使う。 */
  metric: "initialReturnRate" | "currentVsInitial";
  /** 採用した指標の値（%）。 */
  returnRate: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** YYYY-MM-DD を UTC 深夜のタイムスタンプへ。パース不能なら null。 */
function parseDateUtc(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/** listingDate が [today-90日, today] の範囲内（両端含む）かどうか。 */
function isWithinRecentWindow(
  listingDate: string,
  todayIso: string,
  windowDays: number,
): boolean {
  const today = parseDateUtc(todayIso);
  const listed = parseDateUtc(listingDate);
  if (today === null || listed === null) return false;
  const diff = (today - listed) / DAY_MS;
  return diff >= 0 && diff <= windowDays;
}

/** 現在値/初値の変化率（%）。currentPrice/initialPrice のどちらかが null・未取得なら null。 */
function currentVsInitialRate(ipo: Ipo): number | null {
  const current = ipo.currentPrice;
  const initial = ipo.initialPrice;
  if (current === null || current === undefined) return null;
  if (initial === null || initial === undefined) return null;
  if (initial === 0) return null;
  return ((current - initial) / initial) * 100;
}

const RECENT_WINDOW_DAYS = 90;

/**
 * ホームKPI4枚分の値を計算する。
 * - totalCount: 全銘柄数
 * - recentListedCount / avgInitialReturnRate / breakEvenRate: 直近90日上場済のみが対象
 * - topPerformer: 直近90日上場済のうち、initialReturnRate を優先し、無ければ
 *   currentPrice/initialPrice の変化率で最大の銘柄（採用指標は metric に明記）
 */
export function computeKpis(ipos: Ipo[], todayIso: string): HomeKpis {
  const recentListed = ipos.filter(
    (ipo) =>
      ipo.status === "listed" &&
      isWithinRecentWindow(ipo.listingDate, todayIso, RECENT_WINDOW_DAYS),
  );

  const returns = recentListed
    .map((ipo) => initialReturnRate(ipo))
    .filter((v): v is number => v !== null);

  const avgInitialReturnRate =
    returns.length === 0
      ? null
      : returns.reduce((sum, v) => sum + v, 0) / returns.length;

  const breakEvenEligible = recentListed.filter(
    (ipo) => ipo.initialPrice !== null && ipo.offeringPrice !== null,
  );
  const breakEvenCount = breakEvenEligible.filter(
    (ipo) => (ipo.initialPrice as number) < (ipo.offeringPrice as number),
  ).length;
  const breakEvenRate =
    breakEvenEligible.length === 0
      ? null
      : (breakEvenCount / breakEvenEligible.length) * 100;

  let topPerformer: TopPerformer | null = null;
  for (const ipo of recentListed) {
    const viaInitial = initialReturnRate(ipo);
    if (viaInitial !== null) {
      if (topPerformer === null || viaInitial > topPerformer.returnRate) {
        topPerformer = { ipo, metric: "initialReturnRate", returnRate: viaInitial };
      }
      continue;
    }
    const viaCurrent = currentVsInitialRate(ipo);
    if (viaCurrent !== null) {
      if (topPerformer === null || viaCurrent > topPerformer.returnRate) {
        topPerformer = { ipo, metric: "currentVsInitial", returnRate: viaCurrent };
      }
    }
  }

  return {
    totalCount: ipos.length,
    recentListedCount: recentListed.length,
    avgInitialReturnRate,
    initialReturnSampleCount: breakEvenEligible.length,
    breakEvenRate,
    topPerformer,
  };
}

// ---------------------------------------------------------------------------
// イベントタイムライン
// ---------------------------------------------------------------------------

export type HomeEventKind =
  | "bbStart"
  | "allotment"
  | "purchaseStart"
  | "listing";

export interface HomeEvent {
  ipo: Ipo;
  kind: HomeEventKind;
  /** イベント日（YYYY-MM-DD）。 */
  date: string;
}

const EVENT_LABELS: Record<HomeEventKind, string> = {
  bbStart: "BB開始",
  allotment: "抽選",
  purchaseStart: "購入期間開始",
  listing: "上場",
};

export function homeEventLabel(kind: HomeEventKind): string {
  return EVENT_LABELS[kind];
}

/**
 * 今後 days 日以内（today含む）のイベントを日付順に返す。
 * 対象: bbPeriod.start / allotmentDate / purchasePeriod.start / listingDate のうち
 * 期間内のもの。空文字は無視する。同日は kind の優先順（BB開始→抽選→購入期間開始→上場）。
 */
export function upcomingEvents(
  ipos: Ipo[],
  todayIso: string,
  days = 14,
): HomeEvent[] {
  const today = parseDateUtc(todayIso);
  if (today === null) return [];

  const kindOrder: HomeEventKind[] = [
    "bbStart",
    "allotment",
    "purchaseStart",
    "listing",
  ];

  const events: HomeEvent[] = [];
  for (const ipo of ipos) {
    const candidates: [HomeEventKind, string][] = [
      ["bbStart", ipo.bbPeriod.start],
      ["allotment", ipo.allotmentDate],
      ["purchaseStart", ipo.purchasePeriod.start],
      ["listing", ipo.listingDate],
    ];
    for (const [kind, date] of candidates) {
      if (!date) continue;
      const t = parseDateUtc(date);
      if (t === null) continue;
      const diff = (t - today) / DAY_MS;
      if (diff < 0 || diff > days) continue;
      events.push({ ipo, kind, date });
    }
  }

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
  });

  return events;
}

// ---------------------------------------------------------------------------
// スコア上位ピックアップ
// ---------------------------------------------------------------------------

export interface ScoredIpo {
  ipo: Ipo;
  overall: number;
}

/**
 * 総合スコア降順の上位 n 件を返す。completenessFn が 'insufficient' と判定した銘柄は除外する
 * （データ不足銘柄はスコア表示自体を行わない方針のため）。同点は listingDate 昇順。
 */
export function topPicks<T extends ScoredIpo>(
  scored: T[],
  n = 3,
  completenessFn: (ipo: Ipo) => CompletenessResult,
): T[] {
  const eligible = scored.filter(
    ({ ipo }) => completenessFn(ipo).level !== "insufficient",
  );
  eligible.sort((a, b) => {
    if (b.overall !== a.overall) return b.overall - a.overall;
    return a.ipo.listingDate.localeCompare(b.ipo.listingDate);
  });
  return eligible.slice(0, n);
}
