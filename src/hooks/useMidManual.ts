"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { MidManualVerdict } from "@/lib/picks/midSecondary";

// 中長期セカンダリ ①業種業態の目視（◎○×）。端末の localStorage に code → 判定で保存する。
// 読み書きの失敗（プライベートモード・容量超過・壊れた値）は useLocalStorage と normalizeMidManual で吸収する。

export const MID_MANUAL_STORAGE_KEY = "kabu-radar:mid-manual:v1";

const VERDICTS: readonly MidManualVerdict[] = ["strong", "ok", "ng"];

/** 保存データ（壊れた値を含みうる）から、正しい判定だけを残す。 */
export function normalizeMidManual(raw: unknown): Record<string, MidManualVerdict> {
  const out: Record<string, MidManualVerdict> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && (VERDICTS as readonly string[]).includes(v)) out[code] = v as MidManualVerdict;
  }
  return out;
}

export interface UseMidManualResult {
  /** code → ◎○× */
  manual: Record<string, MidManualVerdict>;
  /** 判定を付ける。null（または今と同じ値）で外す */
  setVerdict: (code: string, verdict: MidManualVerdict | null) => void;
  hydrated: boolean;
}

export function useMidManual(): UseMidManualResult {
  const [raw, setRaw, hydrated] = useLocalStorage<Record<string, MidManualVerdict>>(MID_MANUAL_STORAGE_KEY, {});
  const manual = useMemo(() => normalizeMidManual(raw), [raw]);
  const setVerdict = useCallback(
    (code: string, verdict: MidManualVerdict | null) => {
      setRaw((prev) => {
        const next = normalizeMidManual(prev);
        if (verdict === null || next[code] === verdict) delete next[code];
        else next[code] = verdict;
        return next;
      });
    },
    [setRaw],
  );
  return { manual, setVerdict, hydrated };
}
