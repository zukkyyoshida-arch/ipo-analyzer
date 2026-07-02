"use client";

import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weights";
import type {
  ScoreItemKey,
  ScoreSettings,
  Sentiment,
  ScoreWeights,
} from "@/lib/scoring/types";
import { DEFAULT_BROKERS } from "@/data/brokers";

// 証券会社マスタから、主幹事名 -> 係数のマップを作る。
function defaultUnderwriterCoefficients(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of DEFAULT_BROKERS) {
    map[b.name] = b.underwriterCoefficient;
  }
  return map;
}

export const DEFAULT_SETTINGS: ScoreSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentiment: "neutral",
  underwriterCoefficients: defaultUnderwriterCoefficients(),
};

const STORAGE_KEY = "ipo-analyzer:settings:v1";

export interface UseSettingsResult {
  settings: ScoreSettings;
  hydrated: boolean;
  setWeights: (weights: ScoreWeights) => void;
  setWeight: (key: ScoreItemKey, value: number) => void;
  setSentiment: (sentiment: Sentiment) => void;
  setUnderwriterCoefficient: (name: string, value: number) => void;
  reset: () => void;
}

// スコア設定（重み・地合い・主幹事係数）を localStorage に永続化するフック。
export function useSettings(): UseSettingsResult {
  const [settings, setSettings, hydrated] = useLocalStorage<ScoreSettings>(
    STORAGE_KEY,
    DEFAULT_SETTINGS,
  );

  const setWeights = useCallback(
    (weights: ScoreWeights) => {
      setSettings((prev) => ({ ...prev, weights }));
    },
    [setSettings],
  );

  const setWeight = useCallback(
    (key: ScoreItemKey, value: number) => {
      setSettings((prev) => ({
        ...prev,
        weights: { ...prev.weights, [key]: value },
      }));
    },
    [setSettings],
  );

  const setSentiment = useCallback(
    (sentiment: Sentiment) => {
      setSettings((prev) => ({ ...prev, sentiment }));
    },
    [setSettings],
  );

  const setUnderwriterCoefficient = useCallback(
    (name: string, value: number) => {
      setSettings((prev) => ({
        ...prev,
        underwriterCoefficients: {
          ...prev.underwriterCoefficients,
          [name]: value,
        },
      }));
    },
    [setSettings],
  );

  const reset = useCallback(() => {
    setSettings({
      weights: { ...DEFAULT_WEIGHTS },
      sentiment: "neutral",
      underwriterCoefficients: defaultUnderwriterCoefficients(),
    });
  }, [setSettings]);

  return {
    settings,
    hydrated,
    setWeights,
    setWeight,
    setSentiment,
    setUnderwriterCoefficient,
    reset,
  };
}
