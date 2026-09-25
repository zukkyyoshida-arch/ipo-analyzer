"use client";

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Stepper } from "@/components/ui/Stepper";
import type { Broker, LotteryType } from "@/types/broker";

const LOTTERY_LABELS: Record<LotteryType, string> = {
  equal: "完全平等",
  proportional: "比例（資金量）",
  stage: "ステージ制",
  point: "ポイント制",
};

/**
 * 証券会社の主幹事係数設定セクション。各社ステッパー（-2〜+2）。
 * @param brokers 証券会社マスタ
 * @param coefficients 現在の係数（証券会社名 -> 係数）
 * @param onChange 係数変更時のコールバック
 */
export function BrokerCoefficientSection({
  brokers,
  coefficients,
  onChange,
}: {
  brokers: Broker[];
  coefficients: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <Section
      title="証券会社の主幹事係数"
      note="主幹事の需給スコアへの係数（-2〜+2）を調整できます。"
    >
      <Card className="p-4">
        <div className="space-y-4">
          {brokers.map((broker) => {
            const coef = coefficients[broker.name] ?? 0;
            return (
              <div key={broker.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{broker.name}</p>
                  <p className="text-[11px] text-muted">
                    抽選: {LOTTERY_LABELS[broker.lotteryType]} / 前受金:{" "}
                    {broker.requiresDeposit ? "要" : "不要"}
                  </p>
                </div>
                <Stepper
                  value={coef}
                  onChange={(v) => onChange(broker.name, v)}
                  min={-2}
                  max={2}
                  label={`${broker.name}の主幹事係数`}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}
