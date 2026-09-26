"use client";

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { Stepper } from "@/components/ui/Stepper";
import type { ScoreItemKey, ScoreSettings, WeightPreset } from "@/lib/scoring/types";
import {
  SCORE_ITEM_LABELS,
  SUPPLY_DEMAND_KEYS,
  FUNDAMENTAL_KEYS,
  WEIGHT_PRESET_LABELS,
  getPresetWeights,
} from "@/lib/scoring/weights";

const PRESETS: WeightPreset[] = ["supplyDemand", "balanced", "fundamental"];
const PRESET_OPTIONS: SegmentedOption<WeightPreset>[] = PRESETS.map((p) => ({
  value: p,
  label: WEIGHT_PRESET_LABELS[p],
}));

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 5;

/**
 * スコア重み設定セクション。プリセット3種＋各項目のステッパー（0〜5）。
 * @param settings 現在のスコア設定
 * @param onSelectPreset プリセット選択時（重み全体を差し替え）
 * @param onChangeWeight 個別項目の重み変更時
 */
export function WeightSection({
  settings,
  onSelectPreset,
  onChangeWeight,
}: {
  settings: ScoreSettings;
  onSelectPreset: (preset: WeightPreset) => void;
  onChangeWeight: (key: ScoreItemKey, value: number) => void;
}) {
  return (
    <Section
      title="スコア重み"
      note="プリセットを選ぶと各項目の重みがまとめて更新されます。個別に調整も可能です。"
    >
      <Card className="p-4">
        <Segmented
          options={PRESET_OPTIONS}
          value={detectPreset(settings.weights)}
          onChange={(preset) => onSelectPreset(preset)}
        />

        <div className="mt-4 space-y-3">
          <h3 className="text-xs font-bold text-muted">需給スコアの重み</h3>
          {SUPPLY_DEMAND_KEYS.map((key) => (
            <WeightRow
              key={key}
              itemKey={key}
              value={settings.weights[key] ?? 0}
              onChange={onChangeWeight}
            />
          ))}
        </div>

        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <h3 className="text-xs font-bold text-muted">
            ファンダスコアの重み
          </h3>
          {FUNDAMENTAL_KEYS.map((key) => (
            <WeightRow
              key={key}
              itemKey={key}
              value={settings.weights[key] ?? 0}
              onChange={onChangeWeight}
            />
          ))}
        </div>
      </Card>
    </Section>
  );
}

function WeightRow({
  itemKey,
  value,
  onChange,
}: {
  itemKey: ScoreItemKey;
  value: number;
  onChange: (key: ScoreItemKey, value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text">{SCORE_ITEM_LABELS[itemKey]}</span>
      <Stepper
        value={value}
        onChange={(v) => onChange(itemKey, v)}
        min={WEIGHT_MIN}
        max={WEIGHT_MAX}
        label={SCORE_ITEM_LABELS[itemKey]}
      />
    </div>
  );
}

/** 現在の重みがどのプリセットと一致するかを判定する（未一致ならバランスを既定表示）。 */
function detectPreset(weights: ScoreSettings["weights"]): WeightPreset {
  for (const preset of PRESETS) {
    const preset_weights = getPresetWeights(preset);
    const matches = (Object.keys(preset_weights) as ScoreItemKey[]).every(
      (key) => preset_weights[key] === weights[key],
    );
    if (matches) return preset;
  }
  return "balanced";
}
