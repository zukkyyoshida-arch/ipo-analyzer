"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
  DEFAULT_SECONDARY_PROFILE,
  SECONDARY_PRESETS,
  clampProfileValue,
  normalizeSecondaryProfile,
  type PresetStyle,
  type SecondaryProfile,
  type SecondaryStyle,
} from "@/lib/secondary/profiles";

// セカンダリーの「型」（利確線・損切り・最長保有・過熱注意の初値倍率）を localStorage に保存するフック。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。

/** localStorage キー（端末間同期の対象。src/lib/sync/types.ts の SYNC_TARGET_KEYS.secondary と同じ）。 */
export const SECONDARY_STORAGE_KEY = "ipo-analyzer:secondary:v1";

type EditableKey = Exclude<keyof SecondaryProfile, "style">;

export interface UseSecondaryProfileResult {
  profile: SecondaryProfile;
  hydrated: boolean;
  /** 型を選ぶ。カスタムを選ぶと今の値を引き継いで編集できるようにする。 */
  setStyle: (style: SecondaryStyle) => void;
  /** 値を変える（自動でカスタムに切り替わる）。 */
  setValue: (key: EditableKey, value: number) => void;
}

export function useSecondaryProfile(): UseSecondaryProfileResult {
  const [stored, setStored, hydrated] = useLocalStorage<unknown>(
    SECONDARY_STORAGE_KEY,
    DEFAULT_SECONDARY_PROFILE,
  );
  const profile = useMemo(
    () => normalizeSecondaryProfile(stored) ?? DEFAULT_SECONDARY_PROFILE,
    [stored],
  );

  const setStyle = useCallback(
    (style: SecondaryStyle) => {
      setStored((prev: unknown) => {
        const current = normalizeSecondaryProfile(prev) ?? DEFAULT_SECONDARY_PROFILE;
        if (style === "custom") return { ...current, style: "custom" };
        return { ...SECONDARY_PRESETS[style as PresetStyle] };
      });
    },
    [setStored],
  );

  const setValue = useCallback(
    (key: EditableKey, value: number) => {
      setStored((prev: unknown) => {
        const current = normalizeSecondaryProfile(prev) ?? DEFAULT_SECONDARY_PROFILE;
        return { ...current, style: "custom", [key]: clampProfileValue(key, value) };
      });
    },
    [setStored],
  );

  return { profile, hydrated, setStyle, setValue };
}
