"use client";

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import type { Sentiment } from "@/types/ipo";
import type { SentimentMode } from "@/hooks/useSettings";

const MODE_OPTIONS: SegmentedOption<SentimentMode>[] = [
  { value: "auto", label: "自動" },
  { value: "manual", label: "手動" },
];

const MANUAL_OPTIONS: { value: Sentiment; label: string }[] = [
  { value: "strong", label: "強い" },
  { value: "neutral", label: "普通" },
  { value: "weak", label: "弱い" },
];

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  strong: "強い",
  neutral: "普通",
  weak: "弱い",
};

/**
 * 地合い設定セクション。自動／手動 Segmented ＋ 手動時は強い/普通/弱いの Chip 選択。
 * @param mode 現在のモード（自動／手動）
 * @param manualSentiment 手動上書き時の値
 * @param autoSentiment 自動判定された地合い（表示用）
 * @param onChangeMode モード変更
 * @param onChangeManualSentiment 手動値変更
 */
export function SentimentSection({
  mode,
  manualSentiment,
  autoSentiment,
  onChangeMode,
  onChangeManualSentiment,
}: {
  mode: SentimentMode;
  manualSentiment: Sentiment;
  autoSentiment: Sentiment;
  onChangeMode: (mode: SentimentMode) => void;
  onChangeManualSentiment: (sentiment: Sentiment) => void;
}) {
  return (
    <Section
      title="地合い"
      note="日経平均・グロース250のトレンドと直近上場の初値騰落率から機械的に算出します。"
    >
      <Card className="p-4">
        <Segmented options={MODE_OPTIONS} value={mode} onChange={onChangeMode} />

        {mode === "auto" ? (
          <p className="mt-3 text-sm text-text">
            現在の自動判定:{" "}
            <Chip tone="accent">{SENTIMENT_LABEL[autoSentiment]}</Chip>
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {MANUAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeManualSentiment(opt.value)}
                className="min-h-11"
              >
                <Chip tone={manualSentiment === opt.value ? "accent" : "neutral"}>
                  {opt.label}
                </Chip>
              </button>
            ))}
          </div>
        )}
      </Card>
    </Section>
  );
}
