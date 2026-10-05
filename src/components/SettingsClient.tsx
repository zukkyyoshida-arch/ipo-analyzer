"use client";

import type { Broker } from "@/types/broker";
import type { MarketData } from "@/types/data";
import { getPresetWeights } from "@/lib/scoring/weights";
import { useEffect, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
import { Disclosure } from "@/components/ui/Disclosure";
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
    resetWeights,
    resetCoefficients,
    resetThresholds,
    reset,
  } = useSettings(market.sentiment);
  const secondary = useSecondaryProfile();

  // 閉じた折りたたみの中のアンカーへ飛ぶときは、先に開く。
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    el?.querySelector("details")?.setAttribute("open", "");
    el?.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div>
      <h1 className="text-xl font-medium text-text">設定</h1>
      <ScoreNote className="mb-3 mt-1" />

      <nav aria-label="設定の目次" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <a
                href={`#${g.id}`}
                onClick={jump(g.id)}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm text-text active:opacity-80"
              >
                {g.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <GroupHeading id="group-score" title="スコア" />
      <WeightSection
        settings={settings}
        onSelectPreset={(preset) => setWeights(getPresetWeights(preset))}
        onChangeWeight={setWeight}
        onReset={resetWeights}
      />
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
        onReset={resetCoefficients}
      />

      <GroupHeading id="group-method" title="手法" />
      <ThresholdSection
        thresholds={thresholds}
        onChange={setThreshold}
        onPreset={applyThresholdPreset}
        onReset={resetThresholds}
      />
      <SecondarySection
        profile={secondary.profile}
        setStyle={secondary.setStyle}
        setValue={secondary.setValue}
        resetProfile={secondary.resetProfile}
      />

      <div id="group-display" className="mb-4 scroll-mt-32 border-t border-border pt-2">
        <Disclosure summary={<span className="text-lg">表示</span>}>
          <div className="pt-2">
            <ThemeSection />
          </div>
        </Disclosure>
      </div>

      <div id="group-device" className="mb-4 scroll-mt-32 border-t border-border pt-2">
        <Disclosure
          summary={
            <>
              <span className="text-lg">端末</span>
              <PushBlockedBadge />
            </>
          }
        >
          <div className="pt-2">
            <PushOptIn />
            <SyncSection />
            <InstallGuideSection />
          </div>
        </Disclosure>
      </div>

      <GroupHeading id="group-data" title="データ" />
      <DataSection market={market} />
      <ResetSection
        onReset={() => {
          reset();
          secondary.resetProfile();
        }}
      />

      <Disclaimer />
    </div>
  );
}

const GROUPS = [
  { id: "group-score", label: "スコア" },
  { id: "group-method", label: "手法" },
  { id: "group-display", label: "表示" },
  { id: "group-device", label: "端末" },
  { id: "group-data", label: "データ" },
];

/** グループ見出し（目次チップのアンカー先）。固定ヘッダに隠れないよう scroll-mt を付ける。 */
function GroupHeading({ id, title }: { id: string; title: ReactNode }) {
  return (
    <h2 id={id} className="mb-3 scroll-mt-32 border-t border-border pt-4 text-lg font-medium text-text">
      {title}
    </h2>
  );
}

/** 通知がブロック中のときだけ、閉じた「端末」の見出しに出す注意バッジ。 */
function PushBlockedBadge() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocked(typeof Notification !== "undefined" && Notification.permission === "denied");
  }, []);
  if (!blocked) return null;
  return (
    <span className="ml-2 rounded-full border border-down/30 bg-down/15 px-2 py-0.5 text-[11px] font-normal text-down">
      通知ブロック中
    </span>
  );
}
