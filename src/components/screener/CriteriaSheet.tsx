"use client";

import type { Market } from "@/types/ipo";
import type { ScreenerCriteria } from "@/lib/screener";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Stepper } from "@/components/ui/Stepper";
import { Chip } from "@/components/ui/Chip";

const MARKETS: Market[] = ["グロース", "スタンダード", "プライム"];

/**
 * null（条件なし）⇔数値のステッパー1項目。null の間は非活性表示にし、
 * 「有効化」チップを1回押した時だけ既定値をセットして操作可能にする
 * （誤タップで条件なしから数値条件へ意図せず変わることを防ぐ）。
 * 有効化後は「クリア」でnullへ戻せる。
 * @param label 表示ラベル
 * @param value 現在値（null=条件なし）
 * @param defaultValue 有効化時にセットする既定値
 * @param onChange 変更後の値（nullも可）を渡すコールバック
 * @param min 最小値
 * @param max 最大値
 * @param step 増減幅
 */
function NullableStepperRow({
  label,
  value,
  defaultValue,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number | null;
  defaultValue: number;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step: number;
}) {
  const enabled = value !== null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text">{label}</span>
      {enabled ? (
        <div className="flex items-center gap-2">
          <Stepper
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            label={label}
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex min-h-11 items-center px-2 text-xs text-muted underline"
          >
            クリア
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="flex min-h-11 items-center"
        >
          <Chip tone="neutral">未設定（タップで有効化）</Chip>
        </button>
      )}
    </div>
  );
}

/**
 * スクリーナーの手動条件を編集するBottomSheet。
 * @param open 表示状態
 * @param onClose 閉じる要求時のコールバック
 * @param criteria 現在の条件
 * @param onChange 条件変更時のコールバック
 */
export function CriteriaSheet({
  open,
  onClose,
  criteria,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  criteria: ScreenerCriteria;
  onChange: (criteria: ScreenerCriteria) => void;
}) {
  function toggleMarket(market: Market) {
    const has = criteria.markets.includes(market);
    const markets = has
      ? criteria.markets.filter((m) => m !== market)
      : [...criteria.markets, market];
    onChange({ ...criteria, markets });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="条件を編集">
      <div className="space-y-5 pb-2">
        <NullableStepperRow
          label="売上成長率 下限（%）"
          value={criteria.minRevenueGrowth}
          defaultValue={30}
          onChange={(v) => onChange({ ...criteria, minRevenueGrowth: v })}
          min={0}
          max={200}
          step={5}
        />

        <NullableStepperRow
          label="VC比率 上限（%）"
          value={criteria.maxVcRatio}
          defaultValue={30}
          onChange={(v) => onChange({ ...criteria, maxVcRatio: v })}
          min={0}
          max={100}
          step={5}
        />

        <NullableStepperRow
          label="吸収金額 上限（億円）"
          value={criteria.maxAbsorptionAmount}
          defaultValue={30}
          onChange={(v) => onChange({ ...criteria, maxAbsorptionAmount: v })}
          min={0}
          max={500}
          step={10}
        />

        <div>
          <p className="mb-2 text-sm font-medium text-text">市場</p>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((market) => {
              const active = criteria.markets.includes(market);
              return (
                <button
                  key={market}
                  type="button"
                  onClick={() => toggleMarket(market)}
                  className="min-h-11"
                >
                  <Chip tone={active ? "accent" : "neutral"}>{market}</Chip>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">黒字のみ</span>
          <input
            type="checkbox"
            checked={criteria.profitableOnly}
            onChange={(e) =>
              onChange({ ...criteria, profitableOnly: e.target.checked })
            }
            className="h-5 w-5 rounded border-border accent-accent"
          />
        </label>

        <NullableStepperRow
          label="上場からの日数 上限"
          value={criteria.maxDaysSinceListing}
          defaultValue={30}
          onChange={(v) => onChange({ ...criteria, maxDaysSinceListing: v })}
          min={0}
          max={365}
          step={5}
        />
      </div>
    </BottomSheet>
  );
}
