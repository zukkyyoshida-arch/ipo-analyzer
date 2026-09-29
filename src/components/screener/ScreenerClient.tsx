"use client";

import { useEffect, useMemo, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import {
  SCREENER_PRESETS,
  applyScreener,
  matchesAnyPreset,
  type ScreenerCriteria,
  type ScreenerPresetId,
} from "@/lib/screener";
import { assessCompleteness } from "@/lib/completeness";
import { jstTodayIso } from "@/lib/date";
import { scoreIpo, overallScore } from "@/lib/scoring";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist } from "@/hooks/useUserData";
import { IpoCard } from "@/components/IpoCard";
import { Disclaimer, ScoreNote } from "@/components/Disclaimer";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState } from "@/components/ui/EmptyState";
import { CriteriaSheet } from "./CriteriaSheet";

type PresetOrCustom = ScreenerPresetId | "custom";

const PRESET_OPTIONS = [
  ...SCREENER_PRESETS.map((p) => ({ value: p.id as PresetOrCustom, label: p.label })),
];

export function ScreenerClient({
  ipos,
  market,
  todayIso,
}: {
  ipos: Ipo[];
  market: MarketData;
  /** サーバーが計算した日本時間の今日（YYYY-MM-DD）。初回描画の基準日。 */
  todayIso: string;
}) {
  const { settings } = useSettings(market.sentiment);
  const { isWatched, toggle } = useWatchlist();

  const [criteria, setCriteria] = useState<ScreenerCriteria>(
    SCREENER_PRESETS[0].criteria,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  // 初回描画は props.todayIso（サーバーと同じ値）で揃えてハイドレーションを一致させ、
  // マウント後に端末の現在時刻から日本時間の今日へ更新する（ページが長く開かれたままでも追随できる）。
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(jstTodayIso());
  }, []);

  const activePresetId = matchesAnyPreset(criteria);
  const selectedValue: PresetOrCustom = activePresetId ?? "custom";

  const activePreset = activePresetId
    ? SCREENER_PRESETS.find((p) => p.id === activePresetId)
    : undefined;

  function selectPreset(id: PresetOrCustom) {
    if (id === "custom") return;
    const preset = SCREENER_PRESETS.find((p) => p.id === id);
    if (preset) setCriteria(preset.criteria);
  }

  // 各銘柄のスコアを計算（completeness が insufficient のものはスコア対象外）。
  const { scoredMap, completenessMap } = useMemo(() => {
    const scoredMap = new Map<
      string,
      { supply: number; funda: number; overall: number }
    >();
    const completenessMap = new Map<string, ReturnType<typeof assessCompleteness>>();
    for (const ipo of ipos) {
      const completeness = assessCompleteness(ipo);
      completenessMap.set(ipo.code, completeness);
      if (completeness.level === "insufficient") continue;
      const result = scoreIpo(ipo, settings);
      scoredMap.set(ipo.code, {
        supply: result.supplyDemand.score,
        funda: result.fundamental.score,
        overall: overallScore(result),
      });
    }
    return { scoredMap, completenessMap };
  }, [ipos, settings]);

  const results = useMemo(() => {
    return applyScreener(ipos, criteria, {
      watched: isWatched,
      scored: scoredMap,
      today,
    });
  }, [ipos, criteria, isWatched, scoredMap, today]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-medium text-text">スクリーナー</h1>
        <ScoreNote className="mt-1" />
      </div>

      <div className="mb-3">
        <Segmented
          options={PRESET_OPTIONS}
          value={selectedValue}
          onChange={selectPreset}
        />
      </div>

      <p className="mb-3 text-xs text-muted">
        {selectedValue === "custom"
          ? "カスタム条件です。プリセットを選ぶと条件が入れ替わります。"
          : activePreset?.description}
      </p>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="mb-4 min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-left text-sm font-medium text-text active:opacity-80"
      >
        条件を編集
      </button>

      <CriteriaSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        criteria={criteria}
        onChange={setCriteria}
      />

      <h2 className="mb-3 text-sm font-medium text-text">
        条件一致 {results.length} 件
      </h2>

      {results.length === 0 ? (
        <EmptyState
          title="条件に一致する銘柄がありません"
          description="条件を編集するか、別のプリセットを試してください。"
        />
      ) : (
        <div className="space-y-3">
          {results.map(({ ipo, score }) => {
            const completeness = completenessMap.get(ipo.code)?.level ?? "full";
            return (
              <IpoCard
                key={ipo.code}
                ipo={ipo}
                supplyScore={score?.supply ?? 0}
                fundaScore={score?.funda ?? 0}
                watched={isWatched(ipo.code)}
                onToggleWatch={() => toggle(ipo.code)}
                completeness={completeness}
              />
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        機械的な条件一致で、投資判断ではありません。
      </p>

      <Disclaimer />
    </div>
  );
}
