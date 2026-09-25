import type { Ipo } from "@/types/ipo";
import type { ChecklistItem, ChecklistResult, ChecklistVerdict } from "./types";
import { determinePhase, PHASE_LABELS } from "./phase";
import {
  checkPriceRangeRevision,
  checkAbsorption,
  checkGrowth,
  checkLockup,
  checkUnderwriter,
  checkOfferingStructure,
  checkSchedule,
  checkDealType,
  checkMacroEvent,
  checkInitialPriceRatio,
  checkInitialVolume,
  checkMarginRestriction,
  checkFirstEarnings,
  checkLockupExpiry,
  checkPriceReleaseLine,
  checkTopixInclusion,
  checkVolumeLevel,
  checkLargeHolding,
  checkReboundConfirm,
} from "./items";

export * from "./types";
export { determinePhase, PHASE_LABELS } from "./phase";
export * from "./items";

function buildBbSection(ipo: Ipo): ChecklistItem[] {
  return [
    checkPriceRangeRevision(ipo),
    checkAbsorption(ipo),
    checkGrowth(ipo),
    checkLockup(ipo),
    checkUnderwriter(ipo),
    checkOfferingStructure(ipo),
    checkSchedule(ipo),
    checkDealType(ipo),
    checkMacroEvent(),
  ];
}

function buildListingDaySection(ipo: Ipo): ChecklistItem[] {
  return [
    checkInitialPriceRatio(ipo),
    checkInitialVolume(ipo),
    checkMarginRestriction(ipo),
  ];
}

function buildSecondarySection(ipo: Ipo, todayIso: string): ChecklistItem[] {
  const items = [
    checkFirstEarnings(ipo, todayIso),
    checkLockupExpiry(ipo, todayIso),
    checkPriceReleaseLine(ipo),
  ];
  const topix = checkTopixInclusion(ipo, todayIso);
  if (topix) items.push(topix);
  items.push(
    checkVolumeLevel(ipo),
    checkLargeHolding(ipo),
    checkReboundConfirm(),
    checkMarginRestriction(ipo),
  );
  return items;
}

const EMPTY_COUNTS: Record<ChecklistVerdict, number> = {
  pass: 0,
  warn: 0,
  fail: 0,
  unknown: 0,
  manual: 0,
};

function countVerdicts(items: ChecklistItem[]): Record<ChecklistVerdict, number> {
  const counts: Record<ChecklistVerdict, number> = { ...EMPTY_COUNTS };
  for (const item of items) {
    counts[item.verdict] += 1;
  }
  return counts;
}

/**
 * 銘柄の投資判断チェックリストを構築する純関数。
 * 3フェーズ（BB申込／上場当日／セカンダリー）全セクションを返し、
 * UI側で現在フェーズを強調表示できるようにする。
 * counts は現在フェーズのセクションのみ集計する。
 * todayIso は呼び出し側から注入する（純関数を保つため new Date() をここで呼ばない）。
 */
export function buildChecklist(ipo: Ipo, todayIso: string): ChecklistResult {
  const phase = determinePhase(ipo, todayIso);

  const sections = [
    { phase: "bb" as const, label: PHASE_LABELS.bb, items: buildBbSection(ipo) },
    {
      phase: "listingDay" as const,
      label: PHASE_LABELS.listingDay,
      items: buildListingDaySection(ipo),
    },
    {
      phase: "secondary" as const,
      label: PHASE_LABELS.secondary,
      items: buildSecondarySection(ipo, todayIso),
    },
  ];

  const currentSection = sections.find((s) => s.phase === phase);
  const counts = currentSection ? countVerdicts(currentSection.items) : EMPTY_COUNTS;

  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    sections,
    counts,
  };
}
