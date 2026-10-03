"use client";

// 手法のしきい値（共通チェック・短期セカンダリの目安）と資金の設定セクション。

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import {
  CAPITAL_FIELDS,
  MID_THRESHOLD_FIELDS,
  THRESHOLD_FIELDS,
  THRESHOLD_PRESET_LABELS,
  matchPreset,
  type CheckpointThresholds,
  type ThresholdPresetKey,
} from "@/lib/checkpoints/thresholds";

type PresetOption = ThresholdPresetKey | "custom";

const PRESET_OPTIONS: SegmentedOption<PresetOption>[] = [
  ...(Object.keys(THRESHOLD_PRESET_LABELS) as ThresholdPresetKey[]).map((key) => ({
    value: key as PresetOption,
    label: THRESHOLD_PRESET_LABELS[key],
  })),
  { value: "custom", label: "カスタム" },
];

const PRESET_NOTES: Record<ThresholdPresetKey, string> = {
  lecturer:
    "吸収金額 20 億円・公募＋売出 100 万株・利確 2%/10%・損切り 10%／中長期: 自己資本 50%・信用 10 倍・出来高 10 万株",
  conservative:
    "吸収金額 10 億円・公募＋売出 70 万株・利確 2%/8%・損切り 7%／中長期: 自己資本 60%・信用 5 倍・出来高 20 万株",
  aggressive:
    "吸収金額 30 億円・公募＋売出 200 万株・利確 3%/15%・損切り 12%／中長期: 自己資本 30%・信用 20 倍・出来高 5 万株",
};

/**
 * @param thresholds いまのしきい値（既定値で補ったもの）
 * @param onChange 1 項目を変える
 * @param onPreset プリセットを当てる（資金は変えない）
 */
export function ThresholdSection({
  thresholds,
  onChange,
  onPreset,
}: {
  thresholds: CheckpointThresholds;
  onChange: (key: keyof CheckpointThresholds, value: number) => void;
  onPreset: (preset: ThresholdPresetKey) => void;
}) {
  const current: PresetOption = matchPreset(thresholds) ?? "custom";
  const perStock = Math.floor((thresholds.capitalYen * thresholds.maxPerStockPct) / 100);

  return (
    <div id="thresholds" className="scroll-mt-16">
      <Section
        title="資金"
        note="ピックアップの「買える株数」は、投入資金 × 1 銘柄あたりの上限 ÷ 値段を 100 株単位で切り捨てた数です。"
      >
        <Card className="p-4">
          <div className="space-y-3">
            {CAPITAL_FIELDS.map((f) => (
              <NumberRow
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={thresholds[f.key]}
                min={f.min}
                max={f.max}
                step={f.step}
                onCommit={(v) => onChange(f.key, v)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs tabular-nums text-muted">
            1 銘柄あたり {perStock.toLocaleString("ja-JP")}円まで
          </p>
        </Card>
      </Section>

      <Section
        title="手法のしきい値"
        note="銘柄詳細の「チェックポイント」と、ピックアップの BB・短期・中長期セカンダリの判定に使う基準です。"
      >
        <Card className="p-4">
          <Segmented
            options={PRESET_OPTIONS}
            value={current}
            onChange={(v) => {
              if (v !== "custom") onPreset(v);
            }}
          />
          {current !== "custom" ? (
            <p className="mt-2 text-xs text-muted">{PRESET_NOTES[current]}</p>
          ) : (
            <p className="mt-2 text-xs text-muted">数値を個別に変えています。プリセットを選ぶと戻せます。</p>
          )}
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {THRESHOLD_FIELDS.map((f) => (
              <NumberRow
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={thresholds[f.key]}
                min={f.min}
                max={f.max}
                step={f.step}
                onCommit={(v) => onChange(f.key, v)}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <h3 className="text-xs font-medium text-muted">中長期セカンダリ</h3>
            {MID_THRESHOLD_FIELDS.map((f) => (
              <NumberRow
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={thresholds[f.key]}
                min={f.min}
                max={f.max}
                step={f.step}
                onCommit={(v) => onChange(f.key, v)}
              />
            ))}
            <p className="text-[11px] leading-relaxed text-subtle">
              業績・財務・信用残は過去検証で効果が無かったため、候補から外す判定には使わず参考表示にしています（出来高の最低ラインだけ警戒になります）。
            </p>
          </div>
        </Card>
      </Section>
    </div>
  );
}

/** 数値入力の 1 行。入力中は文字のまま持ち、範囲内の数になったときだけ保存する。 */
function NumberRow({
  label,
  unit,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const id = `threshold-${label}`;

  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 text-sm text-text">
        {label}
      </label>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onCommit(n);
          }}
          onBlur={() => setDraft(null)}
          className="min-h-11 w-24 lg:w-32 rounded-lg border border-border bg-surface-2 px-2 text-right text-sm tabular-nums text-text"
        />
        <span className="w-14 text-[11px] leading-tight text-muted lg:w-20">{unit}</span>
      </span>
    </div>
  );
}
