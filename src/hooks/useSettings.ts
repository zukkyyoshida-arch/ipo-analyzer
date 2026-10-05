"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weights";
import type {
  ScoreItemKey,
  ScoreSettings,
  Sentiment,
  ScoreWeights,
} from "@/lib/scoring/types";
import { DEFAULT_BROKERS } from "@/data/brokers";
import {
  DEFAULT_THRESHOLDS,
  applyPreset,
  normalizeThresholds,
  type CheckpointThresholds,
  type ThresholdPresetKey,
} from "@/lib/checkpoints/thresholds";

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
  /** 手法のしきい値と資金。旧データには無いので、読むときに既定値で補う。 */
  thresholds?: Partial<CheckpointThresholds>;
}

const DEFAULT_STORED: StoredSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  sentimentMode: "auto",
  manualSentiment: "neutral",
  underwriterCoefficients: defaultUnderwriterCoefficients(),
  thresholds: { ...DEFAULT_THRESHOLDS },
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
  /** 手法のしきい値と資金（欠けた項目は既定値で補ったもの）。 */
  thresholds: CheckpointThresholds;
  setThreshold: (key: keyof CheckpointThresholds, value: number) => void;
  applyThresholdPreset: (preset: ThresholdPresetKey) => void;
  setWeights: (weights: ScoreWeights) => void;
  setWeight: (key: ScoreItemKey, value: number) => void;
  setSentimentMode: (mode: SentimentMode) => void;
  setManualSentiment: (sentiment: Sentiment) => void;
  setUnderwriterCoefficient: (name: string, value: number) => void;
  /** 重みだけ既定に戻す。 */
  resetWeights: () => void;
  /** 地合い（自動/手動）だけ既定に戻す。 */
  resetSentiment: () => void;
  /** 主幹事係数だけ既定に戻す。 */
  resetCoefficients: () => void;
  /** しきい値と資金だけ既定に戻す。 */
  resetThresholds: () => void;
  /** 重み・地合い・係数・しきい値をまとめて既定に戻す（セカンダリーの型・テーマ・通知・同期などは対象外）。 */
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

  const thresholds = useMemo(() => normalizeThresholds(stored.thresholds), [stored.thresholds]);

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

  const setThreshold = useCallback(
    (key: keyof CheckpointThresholds, value: number) => {
      setStored((prev) => ({
        ...prev,
        thresholds: { ...normalizeThresholds(prev.thresholds), [key]: value },
      }));
    },
    [setStored],
  );

  const applyThresholdPreset = useCallback(
    (preset: ThresholdPresetKey) => {
      setStored((prev) => ({
        ...prev,
        thresholds: applyPreset(normalizeThresholds(prev.thresholds), preset),
      }));
    },
    [setStored],
  );

  const resetWeights = useCallback(() => {
    setStored((prev) => ({ ...prev, weights: { ...DEFAULT_WEIGHTS } }));
  }, [setStored]);

  const resetSentiment = useCallback(() => {
    setStored((prev) => ({ ...prev, sentimentMode: "auto", manualSentiment: "neutral" }));
  }, [setStored]);

  const resetCoefficients = useCallback(() => {
    setStored((prev) => ({ ...prev, underwriterCoefficients: defaultUnderwriterCoefficients() }));
  }, [setStored]);

  const resetThresholds = useCallback(() => {
    setStored((prev) => ({ ...prev, thresholds: { ...DEFAULT_THRESHOLDS } }));
  }, [setStored]);

  const reset = useCallback(() => {
    setStored({
      weights: { ...DEFAULT_WEIGHTS },
      sentimentMode: "auto",
      manualSentiment: "neutral",
      underwriterCoefficients: defaultUnderwriterCoefficients(),
      thresholds: { ...DEFAULT_THRESHOLDS },
    });
  }, [setStored]);

  return {
    settings,
    sentimentMode: stored.sentimentMode,
    manualSentiment: stored.manualSentiment,
    effectiveSentiment,
    hydrated,
    thresholds,
    setThreshold,
    applyThresholdPreset,
    setWeights,
    setWeight,
    setSentimentMode,
    setManualSentiment,
    setUnderwriterCoefficient,
    resetWeights,
    resetSentiment,
    resetCoefficients,
    resetThresholds,
    reset,
  };
}
