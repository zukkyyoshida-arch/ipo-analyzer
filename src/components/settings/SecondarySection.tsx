"use client";

// セカンダリーの型（利確線・損切り・最長保有・過熱注意の初値倍率）の設定セクション。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { Stepper } from "@/components/ui/Stepper";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
import {
  PRESET_BACKTEST,
  PRESET_NOTES,
  PROFILE_LIMITS,
  SECONDARY_PRESETS,
  SECONDARY_STYLE_LABELS,
  formatSignedPct,
  type PresetStyle,
  type SecondaryProfile,
  type SecondaryStyle,
} from "@/lib/secondary/profiles";

const STYLES: SecondaryStyle[] = ["solid", "standard", "aggressive", "custom"];
const STYLE_OPTIONS: SegmentedOption<SecondaryStyle>[] = STYLES.map((s) => ({
  value: s,
  label: SECONDARY_STYLE_LABELS[s],
}));
const PRESETS: PresetStyle[] = ["solid", "standard", "aggressive"];

/** 型の中身を1行で。 */
function describeProfile(p: SecondaryProfile): string {
  const tp = p.takeProfitPctOfWidth === 100 ? "ストップ高（値幅の100%）" : `値幅の${p.takeProfitPctOfWidth}%`;
  return `利確 ${tp}／損切り −${p.stopLossPct}%／最長 ${p.maxHoldDays}営業日`;
}

export function SecondarySection() {
  const { profile, setStyle, setValue } = useSecondaryProfile();

  return (
    <div id="secondary" className="scroll-mt-16">
      <Section
        title="セカンダリーの型"
        note="銘柄詳細の「セカンダリー」に出す利確線・損切り線・注意の基準です。初値で買った場合を想定しています。"
      >
        <Card className="p-4">
          <Segmented options={STYLE_OPTIONS} value={profile.style} onChange={setStyle} />

          <ul className="mt-3 space-y-2">
            {PRESETS.map((style) => {
              const preset = SECONDARY_PRESETS[style];
              const bt = PRESET_BACKTEST[style];
              const active = profile.style === style;
              return (
                <li
                  key={style}
                  className={`rounded-lg border p-3 ${active ? "border-text" : "border-border"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-text">
                      {SECONDARY_STYLE_LABELS[style]}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      平均 {formatSignedPct(bt.meanPct)}／勝率 {bt.winRatePct}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{describeProfile(preset)}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    初値倍率 {preset.overheatRatio.toFixed(1)}倍超で「中期は不利」の注意。
                    {PRESET_NOTES[style]}
                  </p>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-[11px] text-subtle">
            過去の平均・勝率は2024〜2026年の上場銘柄（約160件）で、初値で買い、利確線・損切り線・最長保有のどれかで手仕舞いした場合。平均はどの型も0と区別できない差で、違うのは勝率と損の形です。
          </p>

          {profile.style === "custom" ? (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <h3 className="text-xs font-medium text-muted">カスタムの値</h3>
              <ValueRow
                label="利確線（初日の値幅の%）"
                value={profile.takeProfitPctOfWidth}
                display={`${profile.takeProfitPctOfWidth}%`}
                limits={PROFILE_LIMITS.takeProfitPctOfWidth}
                onChange={(v) => setValue("takeProfitPctOfWidth", v)}
              />
              <ValueRow
                label="損切り（初値から −%）"
                value={profile.stopLossPct}
                display={`−${profile.stopLossPct}%`}
                limits={PROFILE_LIMITS.stopLossPct}
                onChange={(v) => setValue("stopLossPct", v)}
              />
              <ValueRow
                label="最長保有（営業日）"
                value={profile.maxHoldDays}
                display={`${profile.maxHoldDays}日`}
                limits={PROFILE_LIMITS.maxHoldDays}
                onChange={(v) => setValue("maxHoldDays", v)}
              />
              <ValueRow
                label="過熱注意の初値倍率"
                value={profile.overheatRatio}
                display={`${profile.overheatRatio.toFixed(1)}倍`}
                limits={PROFILE_LIMITS.overheatRatio}
                onChange={(v) => setValue("overheatRatio", v)}
              />
              <p className="text-[11px] text-subtle">
                カスタムの過去成績は計算していません。銘柄詳細では、近い値の「届いた割合」を参考に出します。
              </p>
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  );
}

function ValueRow({
  label,
  value,
  display,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  limits: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-text">{label}</p>
        <p className="text-xs text-muted">{display}</p>
      </div>
      <Stepper
        value={value}
        onChange={onChange}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        label={label}
      />
    </div>
  );
}
