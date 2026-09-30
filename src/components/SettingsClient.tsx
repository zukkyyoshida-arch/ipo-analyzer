"use client";

import type { Broker } from "@/types/broker";
import type { MarketData } from "@/types/data";
import { getPresetWeights } from "@/lib/scoring/weights";
import { useSettings } from "@/hooks/useSettings";
import { Disclaimer, ScoreNote } from "@/components/Disclaimer";
import { WeightSection } from "@/components/settings/WeightSection";
import { SecondarySection } from "@/components/settings/SecondarySection";
import { SentimentSection } from "@/components/settings/SentimentSection";
import { BrokerCoefficientSection } from "@/components/settings/BrokerCoefficientSection";
import { ThemeSection } from "@/components/settings/ThemeSection";
import { DataSection } from "@/components/settings/DataSection";
import { InstallGuideSection } from "@/components/settings/InstallGuideSection";
import { ResetSection } from "@/components/settings/ResetSection";
import { PushOptIn } from "@/components/settings/PushOptIn";
import { SyncSection } from "@/components/settings/SyncSection";
import { ThresholdSection } from "@/components/settings/ThresholdSection";

/**
 * 設定画面のクライアント本体。スコア重み・地合い・主幹事係数・テーマ・データ・
 * アプリ化手順・免責・リセットのセクションを縦に並べる。
 * @param brokers 証券会社マスタ（サーバーから props で渡す）
 * @param market 地合い自動判定と更新日時（サーバーから props で渡す）
 */
export function SettingsClient({
  brokers,
  market,
}: {
  brokers: Broker[];
  market: MarketData;
}) {
  const {
    settings,
    sentimentMode,
    manualSentiment,
    setWeight,
    setWeights,
    setSentimentMode,
    setManualSentiment,
    setUnderwriterCoefficient,
    thresholds,
    setThreshold,
    applyThresholdPreset,
    reset,
  } = useSettings(market.sentiment);

  return (
    <div>
      <h1 className="text-xl font-medium text-text">設定</h1>
      <ScoreNote className="mb-4 mt-1" />

      <WeightSection
        settings={settings}
        onSelectPreset={(preset) => setWeights(getPresetWeights(preset))}
        onChangeWeight={setWeight}
      />

      <ThresholdSection
        thresholds={thresholds}
        onChange={setThreshold}
        onPreset={applyThresholdPreset}
      />

      <SecondarySection />

      <SentimentSection
        mode={sentimentMode}
        manualSentiment={manualSentiment}
        autoSentiment={market.sentiment}
        onChangeMode={setSentimentMode}
        onChangeManualSentiment={setManualSentiment}
      />

      <BrokerCoefficientSection
        brokers={brokers}
        coefficients={settings.underwriterCoefficients}
        onChange={setUnderwriterCoefficient}
      />

      <ThemeSection />

      <PushOptIn />

      <SyncSection />

      <DataSection market={market} />

      <InstallGuideSection />

      <ResetSection onReset={reset} />

      <Disclaimer />
    </div>
  );
}
