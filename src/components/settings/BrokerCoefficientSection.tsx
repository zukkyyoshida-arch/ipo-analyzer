"use client";

import { Card } from "@/components/ui/Card";
import { ResetLink } from "@/components/settings/ResetLink";
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
 * 証券会社セクション。各社の「使っている」チェック（口座あり）と主幹事係数ステッパー（-2〜+2）。
 * チェックした証券だけが銘柄詳細の「BB申込状況」に並ぶ（1社もチェックしなければ全社）。
 * @param brokers 証券会社マスタ
 * @param coefficients 現在の係数（証券会社名 -> 係数）
 * @param onChange 係数変更時のコールバック
 * @param myBrokers 使っている証券会社の id
 * @param onToggleMyBroker 「使っている」チェックの切替
 */
export function BrokerCoefficientSection({
  brokers,
  coefficients,
  onChange,
  onReset,
  myBrokers,
  onToggleMyBroker,
}: {
  brokers: Broker[];
  coefficients: Record<string, number>;
  onChange: (name: string, value: number) => void;
  onReset: () => void;
  myBrokers: string[];
  onToggleMyBroker: (brokerId: string) => void;
}) {
  const selectedCount = brokers.filter((b) => myBrokers.includes(b.id)).length;
  return (
    <Section
      id="brokers"
      title="証券会社（口座・主幹事係数）"
      action={<ResetLink label="主幹事係数" onReset={onReset} />}
      note="口座のある証券にチェックすると、銘柄詳細のBB申込状況がその証券だけになります。右の数字は主幹事の需給スコアへの係数（-2〜+2）です。"
    >
      <Card className="p-4">
        <div className="space-y-4">
          {brokers.map((broker) => {
            const coef = coefficients[broker.name] ?? 0;
            const mine = myBrokers.includes(broker.id);
            return (
              <div key={broker.id} className="flex items-center justify-between gap-3">
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={mine}
                    onChange={() => onToggleMyBroker(broker.id)}
                    className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                    aria-label={`${broker.name}を使っている証券にする`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text">{broker.name}</span>
                    <span className="block text-[11px] text-muted">
                      抽選: {LOTTERY_LABELS[broker.lotteryType]} / 前受金:{" "}
                      {broker.requiresDeposit ? "要" : "不要"}
                    </span>
                  </span>
                </label>
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
        <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted">
          {selectedCount > 0
            ? `使っている証券: ${selectedCount}社（BB申込状況にはこの${selectedCount}社だけを出します）`
            : "未選択のため、BB申込状況には全社を出しています。"}
        </p>
      </Card>
    </Section>
  );
}
