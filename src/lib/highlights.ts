import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "@/lib/scoring/types";
import { scoreIpo } from "@/lib/scoring";

// 「需給タイト度 上位」セクションの選定ロジック（純関数）。テスト対象。
//
// 中立表現のみ。特定銘柄の評価を意味するものではなく、需給スコアの機械的な降順上位。

export interface HighlightEntry {
  ipo: Ipo;
  supplyScore: number;
}

/** 選定対象の日数窓（上場まで/上場後この日数以内の upcoming を含める）。 */
export const HIGHLIGHT_UPCOMING_WINDOW_DAYS = 14;

/** 2つの YYYY-MM-DD の差（b - a）を日数で返す。パース不能なら null。 */
function diffDays(a: string, b: string): number | null {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / (24 * 3600 * 1000));
}

/**
 * 需給タイト度の上位銘柄を返す。
 * 対象: status が bb_open / priced、または upcoming で上場まで14日以内。
 * 並び: 需給スコア降順。同点は上場日が近い順。
 */
export function selectSupplyDemandHighlights(
  ipos: Ipo[],
  settings: ScoreSettings,
  today: string,
  limit = 3,
): HighlightEntry[] {
  const candidates = ipos.filter((ipo) => {
    if (ipo.status === "bb_open" || ipo.status === "priced") return true;
    if (ipo.status === "upcoming") {
      const d = diffDays(today, ipo.listingDate);
      // 上場日が未来かつ14日以内なら対象。日付不明は除外。
      return d !== null && d >= 0 && d <= HIGHLIGHT_UPCOMING_WINDOW_DAYS;
    }
    return false;
  });

  const scored: HighlightEntry[] = candidates.map((ipo) => ({
    ipo,
    supplyScore: scoreIpo(ipo, settings).supplyDemand.score,
  }));

  scored.sort((a, b) => {
    if (b.supplyScore !== a.supplyScore) return b.supplyScore - a.supplyScore;
    return a.ipo.listingDate.localeCompare(b.ipo.listingDate);
  });

  return scored.slice(0, limit);
}
