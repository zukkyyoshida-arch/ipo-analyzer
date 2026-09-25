"use client";

import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "@/lib/scoring/types";
import { IpoCard } from "@/components/IpoCard";
import { scoreIpo } from "@/lib/scoring";
import { assessCompleteness } from "@/lib/completeness";
import { useWatchlist } from "@/hooks/useUserData";

/**
 * 類似IPO一覧。similarIpoCodes から解決済みの銘柄配列を受け取り、共通 IpoCard で表示する。
 * 呼び出し側で空配列ならセクション自体を非表示にする（このコンポーネントはリストのみ担当）。
 */
export function SimilarIpos({
  ipos,
  settings,
}: {
  ipos: Ipo[];
  settings: ScoreSettings;
}) {
  const { isWatched, toggle } = useWatchlist();

  return (
    <div className="space-y-3">
      {ipos.map((ipo) => {
        const completeness = assessCompleteness(ipo).level;
        const score = scoreIpo(ipo, settings);
        return (
          <IpoCard
            key={ipo.code}
            ipo={ipo}
            supplyScore={score.supplyDemand.score}
            fundaScore={score.fundamental.score}
            watched={isWatched(ipo.code)}
            onToggleWatch={() => toggle(ipo.code)}
            completeness={completeness}
          />
        );
      })}
    </div>
  );
}
