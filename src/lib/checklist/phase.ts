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
