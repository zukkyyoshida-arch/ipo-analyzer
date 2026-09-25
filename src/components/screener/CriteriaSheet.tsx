"use client";

import type { Market } from "@/types/ipo";
import type { ScreenerCriteria } from "@/lib/screener";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Stepper } from "@/components/ui/Stepper";
import { Chip } from "@/components/ui/Chip";

const MARKETS: Market[] = ["グロース", "スタンダード", "プライム"];

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
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">
            売上成長率 下限（%）
          </span>
          <Stepper
            value={criteria.minRevenueGrowth ?? 0}
            onChange={(v) => onChange({ ...criteria, minRevenueGrowth: v })}
            min={0}
            max={200}
            step={5}
            label="売上成長率下限"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">
            VC比率 上限（%）
          </span>
          <Stepper
            value={criteria.maxVcRatio ?? 100}
            onChange={(v) => onChange({ ...criteria, maxVcRatio: v })}
            min={0}
            max={100}
            step={5}
            label="VC比率上限"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">
            吸収金額 上限（億円）
          </span>
          <Stepper
            value={criteria.maxAbsorptionAmount ?? 0}
            onChange={(v) =>
              onChange({ ...criteria, maxAbsorptionAmount: v })
            }
            min={0}
            max={500}
            step={10}
            label="吸収金額上限"
          />
        </div>

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

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">
            上場からの日数 上限
          </span>
          <Stepper
            value={criteria.maxDaysSinceListing ?? 0}
            onChange={(v) =>
              onChange({ ...criteria, maxDaysSinceListing: v })
            }
            min={0}
            max={365}
            step={5}
            label="上場からの日数上限"
          />
        </div>
      </div>
    </BottomSheet>
  );
}
