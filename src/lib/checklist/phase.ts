import type { Ipo } from "@/types/ipo";
import type { ChecklistPhase } from "./types";

// 現在フェーズの判定。listingDate と todayIso（YYYY-MM-DD、呼び出し側から注入）を比較する純関数。
export function determinePhase(ipo: Ipo, todayIso: string): ChecklistPhase {
  if (!ipo.listingDate) return "bb";
  if (todayIso < ipo.listingDate) return "bb";
  if (todayIso === ipo.listingDate) return "listingDay";
  return "secondary";
}

export const PHASE_LABELS: Record<ChecklistPhase, string> = {
  bb: "BB申込",
  listingDay: "上場当日",
  secondary: "セカンダリー",
};

// ---- 銘柄詳細の並べ替え用フェーズ（5区分） ----
// determinePhase（チェックリスト用の3区分）より細かく、上場前を BB前／BB中／抽選〜購入 に分ける。

/** 銘柄詳細ページのフェーズ。preBb=BB前 / bbOpen=BB中 / lottery=抽選〜購入 / listingDay=上場当日 / listed=上場後 */
export type DetailPhase = "preBb" | "bbOpen" | "lottery" | "listingDay" | "listed";

export const DETAIL_PHASE_LABELS: Record<DetailPhase, string> = {
  preBb: "BB前",
  bbOpen: "BB中",
  lottery: "抽選〜購入",
  listingDay: "上場当日",
  listed: "上場後",
};

/**
 * 銘柄詳細のフェーズ判定（純関数）。日程（YYYY-MM-DD）を優先し、日程が欠けるときは ipo.status で補う。
 * @param ipo 対象銘柄
 * @param todayIso 今日（YYYY-MM-DD、呼び出し側から注入）
 */
export function determineDetailPhase(ipo: Ipo, todayIso: string): DetailPhase {
  const { listingDate, bbPeriod } = ipo;
  if (listingDate) {
    if (todayIso === listingDate) return "listingDay";
    if (todayIso > listingDate) return "listed";
  } else if (ipo.status === "listed") {
    return "listed";
  }
  if (bbPeriod.start && todayIso < bbPeriod.start) return "preBb";
  if (bbPeriod.end) return todayIso <= bbPeriod.end ? "bbOpen" : "lottery";
  if (bbPeriod.start) return "bbOpen";
  if (ipo.status === "bb_open") return "bbOpen";
  if (ipo.status === "priced") return "lottery";
  if (ipo.status === "listed") return "listed";
  return "preBb";
}

/** 上場前（BB前〜購入）のフェーズか。 */
export function isPreListingPhase(phase: DetailPhase): boolean {
  return phase === "preBb" || phase === "bbOpen" || phase === "lottery";
}

export interface UpcomingDeadline {
  /** 例: 「BB締切まで」 */
  label: string;
  /** 期日（YYYY-MM-DD） */
  date: string;
  /** 今日から期日までの日数（当日は 0） */
  daysLeft: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * 今日以降で最も近い「次の期日」を返す（純関数）。BB開始→BB締切→抽選日→購入締切→上場日の順に見る。
 * 該当が無い（日程未取得・すべて過去）ときは null。
 */
export function nextDeadline(ipo: Ipo, todayIso: string): UpcomingDeadline | null {
  const steps: { label: string; date: string }[] = [
    { label: "BB開始まで", date: ipo.bbPeriod.start },
    { label: "BB締切まで", date: ipo.bbPeriod.end },
    { label: "抽選日まで", date: ipo.allotmentDate },
    { label: "購入締切まで", date: ipo.purchasePeriod.end },
    { label: "上場日まで", date: ipo.listingDate },
  ];
  for (const step of steps) {
    if (!step.date || step.date < todayIso) continue;
    // BB開始当日はもう「BB中」なので、締切のほうを見せる。
    if (step.label === "BB開始まで" && step.date === todayIso) continue;
    return { ...step, daysLeft: daysBetween(todayIso, step.date) };
  }
  return null;
}
