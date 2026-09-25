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

/** 地合いの決定方式。auto=市場データの自動判定を使う / manual=手動で上書き */
export type SentimentMode = "auto" | "manual";

// localStorage に保存する設定本体。
// sentiment は「手動上書き時の値」。実際にスコア計算へ渡す地合いは
// sentimentMode と自動判定値から算出する（effectiveSentiment）。
interface StoredSettings {
  weights: ScoreWeights;
  sentimentMode: SentimentMode;
  /** 手動上書き時の地合い */
  manualSentiment: Sentiment;
  underwriterCoefficients: Record<string, number>;
}

const DEFAULT_STORED: StoredSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentimentMode: "auto",
  manualSentiment: "neutral",
  underwriterCoefficients: defaultUnderwriterCoefficients(),
};

/** 後方互換の既定スコア設定（auto の自動値が無い場合の中立値）。 */
export const DEFAULT_SETTINGS: ScoreSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentiment: "neutral",
  underwriterCoefficients: defaultUnderwriterCoefficients(),
};

const STORAGE_KEY = "ipo-analyzer:settings:v2";

export interface UseSettingsResult {
  /** スコア計算にそのまま渡せる設定（effective sentiment を反映済み）。 */
  settings: ScoreSettings;
  sentimentMode: SentimentMode;
  /** 手動上書き時の地合い（manual モードで使用）。 */
  manualSentiment: Sentiment;
  /** 実際に適用中の地合い（auto の自動判定 or 手動値）。 */
  effectiveSentiment: Sentiment;
  hydrated: boolean;
  setWeights: (weights: ScoreWeights) => void;
  setWeight: (key: ScoreItemKey, value: number) => void;
  setSentimentMode: (mode: SentimentMode) => void;
  setManualSentiment: (sentiment: Sentiment) => void;
  setUnderwriterCoefficient: (name: string, value: number) => void;
  reset: () => void;
}

// スコア設定を localStorage に永続化するフック。
// autoSentiment: 市場データの自動判定値（サーバーから渡す）。auto モード時に使用。
export function useSettings(autoSentiment?: Sentiment): UseSettingsResult {
  const [stored, setStored, hydrated] = useLocalStorage<StoredSettings>(
    STORAGE_KEY,
    DEFAULT_STORED,
  );

  const effectiveSentiment: Sentiment =
    stored.sentimentMode === "auto"
      ? (autoSentiment ?? "neutral")
      : stored.manualSentiment;

  const settings: ScoreSettings = {
    weights: stored.weights,
    sentiment: effectiveSentiment,
    underwriterCoefficients: stored.underwriterCoefficients,
  };

  const setWeights = useCallback(
    (weights: ScoreWeights) => {
      setStored((prev) => ({ ...prev, weights }));
    },
    [setStored],
  );

  const setWeight = useCallback(
    (key: ScoreItemKey, value: number) => {
      setStored((prev) => ({
        ...prev,
        weights: { ...prev.weights, [key]: value },
      }));
    },
    [setStored],
  );

  const setSentimentMode = useCallback(
    (mode: SentimentMode) => {
      setStored((prev) => ({ ...prev, sentimentMode: mode }));
    },
    [setStored],
  );

  const setManualSentiment = useCallback(
    (sentiment: Sentiment) => {
      setStored((prev) => ({ ...prev, manualSentiment: sentiment }));
    },
    [setStored],
  );

  const setUnderwriterCoefficient = useCallback(
    (name: string, value: number) => {
      setStored((prev) => ({
        ...prev,
        underwriterCoefficients: {
          ...prev.underwriterCoefficients,
          [name]: value,
        },
      }));
    },
    [setStored],
  );

  const reset = useCallback(() => {
    setStored({
      weights: { ...DEFAULT_WEIGHTS },
      sentimentMode: "auto",
      manualSentiment: "neutral",
      underwriterCoefficients: defaultUnderwriterCoefficients(),
    });
  }, [setStored]);

  return {
    settings,
    sentimentMode: stored.sentimentMode,
    manualSentiment: stored.manualSentiment,
    effectiveSentiment,
    hydrated,
    setWeights,
    setWeight,
    setSentimentMode,
    setManualSentiment,
    setUnderwriterCoefficient,
    reset,
  };
}
