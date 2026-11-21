import type { Ipo } from "@/types/ipo";

// BB管理画面の銘柄を「BB中・これから」「抽選・購入待ち」「終了」の3区分に分ける純関数。
// 「今日」は呼び出し側が todayIso（日本時間の YYYY-MM-DD）として渡す（Date.now は呼ばない）。

export type BbSectionId = "active" | "waiting" | "ended";

export const BB_SECTION_ORDER: readonly BbSectionId[] = ["active", "waiting", "ended"];

export const BB_SECTION_LABELS: Record<BbSectionId, string> = {
  active: "BB中・これから",
  waiting: "抽選・購入待ち",
  ended: "終了",
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function iso(value: string | null | undefined): string | null {
  return typeof value === "string" && ISO_RE.test(value) ? value : null;
}

/**
 * 銘柄1件の区分。
 * - active（BB中・これから）: BB 終了日 >= 今日。BB 期間が未取得なら、上場日が過ぎていない限りここ
 * - waiting（抽選・購入待ち）: BB 終了日 < 今日 で、購入期間の終了日か上場日のどちらかが >= 今日
 * - ended（終了）: それ以外（BB も購入期間も上場日も過ぎた）
 * BB 終了日が無く開始日だけある場合は開始日を終了日の代わりに使う。
 */
export function bbSectionOf(ipo: Ipo, todayIso: string): BbSectionId {
  const bbEnd = iso(ipo.bbPeriod.end) ?? iso(ipo.bbPeriod.start);
  const purchaseEnd = iso(ipo.purchasePeriod.end);
  const listing = iso(ipo.listingDate);

  if (bbEnd === null) {
    // BB 日程が未取得: 上場日が過ぎていれば終了、それ以外はこれからの銘柄として扱う。
    return listing !== null && listing < todayIso ? "ended" : "active";
  }
  if (bbEnd >= todayIso) return "active";
  if ((purchaseEnd !== null && purchaseEnd >= todayIso) || (listing !== null && listing >= todayIso)) {
    return "waiting";
  }
  return "ended";
}

/** 区分内の並び: BB 開始日の昇順（未取得は末尾）→ コード順。 */
function compareByBbStart(a: Ipo, b: Ipo): number {
  const sa = iso(a.bbPeriod.start);
  const sb = iso(b.bbPeriod.start);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa.localeCompare(sb);
  }
  return a.code.localeCompare(b.code);
}

export interface BbSection {
  id: BbSectionId;
  label: string;
  ipos: Ipo[];
}

/**
 * 銘柄を3区分に分け、各区分を BB 開始日の昇順に並べる。0件の区分は返さない。
 * 並びは「BB中・これから」→「抽選・購入待ち」→「終了」。
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function groupBbSections(ipos: Ipo[], todayIso: string): BbSection[] {
  const buckets: Record<BbSectionId, Ipo[]> = { active: [], waiting: [], ended: [] };
  for (const ipo of ipos) buckets[bbSectionOf(ipo, todayIso)].push(ipo);
  return BB_SECTION_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: BB_SECTION_LABELS[id],
    ipos: [...buckets[id]].sort(compareByBbStart),
  }));
}
