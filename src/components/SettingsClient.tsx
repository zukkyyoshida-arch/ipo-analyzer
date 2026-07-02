"use client";

import type { Broker } from "@/types/broker";
import type { Sentiment, WeightPreset } from "@/lib/scoring/types";
import {
  SCORE_ITEM_LABELS,
  SUPPLY_DEMAND_KEYS,
  FUNDAMENTAL_KEYS,
  WEIGHT_PRESET_LABELS,
  getPresetWeights,
} from "@/lib/scoring/weights";
import { useSettings } from "@/hooks/useSettings";
import { ScoreNote } from "./Disclaimer";

const SENTIMENTS: { value: Sentiment; label: string }[] = [
  { value: "strong", label: "強い (+2)" },
  { value: "neutral", label: "普通 (0)" },
  { value: "weak", label: "弱い (-2)" },
];

const PRESETS: WeightPreset[] = ["supplyDemand", "balanced", "fundamental"];

const WEIGHT_MAX = 6;

export function SettingsClient({ brokers }: { brokers: Broker[] }) {
  const {
    settings,
    setWeights,
    setWeight,
    setSentiment,
    setUnderwriterCoefficient,
    reset,
  } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">設定</h1>
        <ScoreNote className="mt-1" />
      </div>

      {/* 重みプリセット */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">重みプリセット</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setWeights(getPresetWeights(preset))}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {WEIGHT_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          プリセットを選ぶと下のスライダーがまとめて更新されます。
        </p>
      </section>

      {/* 需給スコアの重み */}
      <WeightGroup
        title="需給スコアの重み"
        keys={SUPPLY_DEMAND_KEYS}
        settings={settings}
        onChange={setWeight}
      />

      {/* ファンダスコアの重み */}
      <WeightGroup
        title="ファンダスコアの重み"
        keys={FUNDAMENTAL_KEYS}
        settings={settings}
        onChange={setWeight}
      />

      {/* 地合い */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">地合い（全銘柄共通）</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {SENTIMENTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSentiment(s.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                settings.sentiment === s.value
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* 証券会社マスタ */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">
          証券会社マスタ（主幹事係数）
        </h2>
        <p className="mt-1 text-[11px] text-slate-400">
          主幹事の需給スコアへの係数（-2〜+2）を調整できます。
        </p>
        <div className="mt-3 space-y-3">
          {brokers.map((broker) => {
            const coef = settings.underwriterCoefficients[broker.name] ?? 0;
            return (
              <div key={broker.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">
                    {broker.name}
                  </span>
                  <span className="tabular-nums font-semibold text-slate-800">
                    {coef > 0 ? "+" : ""}
                    {coef}
                  </span>
                </div>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={1}
                  value={coef}
                  onChange={(e) =>
                    setUnderwriterCoefficient(
                      broker.name,
                      Number(e.target.value),
                    )
                  }
                  className="mt-1 w-full accent-slate-800"
                />
                <p className="text-[11px] text-slate-400">
                  抽選: {lotteryLabel(broker.lotteryType)} / 前受金:{" "}
                  {broker.requiresDeposit ? "要" : "不要"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* リセット */}
      <section>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          設定を初期値に戻す
        </button>
      </section>
    </div>
  );
}

function WeightGroup({
  title,
  keys,
  settings,
  onChange,
}: {
  title: string;
  keys: readonly (keyof typeof SCORE_ITEM_LABELS)[];
  settings: { weights: Record<string, number> };
  onChange: (key: keyof typeof SCORE_ITEM_LABELS, value: number) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      <div className="mt-3 space-y-3">
        {keys.map((key) => {
          const value = settings.weights[key] ?? 0;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{SCORE_ITEM_LABELS[key]}</span>
                <span className="tabular-nums font-semibold text-slate-800">
                  {value}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={WEIGHT_MAX}
                step={1}
                value={value}
                onChange={(e) => onChange(key, Number(e.target.value))}
                className="mt-1 w-full accent-slate-800"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function lotteryLabel(type: Broker["lotteryType"]): string {
  switch (type) {
    case "equal":
      return "完全平等";
    case "proportional":
      return "比例（資金量）";
    case "stage":
      return "ステージ制";
    case "point":
      return "ポイント制";
  }
}
