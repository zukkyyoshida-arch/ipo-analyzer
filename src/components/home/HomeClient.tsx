"use client";

import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import { Disclaimer, ScoreNote } from "@/components/Disclaimer";
import { SentimentBanner } from "@/components/SentimentBanner";
import { SupplyDemandHighlights } from "@/components/SupplyDemandHighlights";
import { Section } from "@/components/ui/Section";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist } from "@/hooks/useUserData";
import { scoreIpo, overallScore } from "@/lib/scoring";
import { assessCompleteness } from "@/lib/completeness";
import { computeKpis, upcomingEvents, topPicks } from "@/lib/home";
import { KpiGrid } from "./KpiGrid";
import { EventTimeline } from "./EventTimeline";
import { TopPicks, type TopPickItem } from "./TopPicks";

/**
 * ホーム（Market Radar）画面のクライアント本体。
 * 「今日」はページ（Server Component）が計算して渡す todayIso をそのまま使い、
 * クライアント側で Date.now を呼ばない（ハイドレーション不整合を避けるため）。
 */
export function HomeClient({
  ipos,
  market,
  todayIso,
}: {
  ipos: Ipo[];
  market: MarketData;
  todayIso: string;
}) {
  const { settings, effectiveSentiment, sentimentMode } = useSettings(
    market.sentiment,
  );
  const { isWatched, toggle } = useWatchlist();

  const kpis = useMemo(() => computeKpis(ipos, todayIso), [ipos, todayIso]);

  const events = useMemo(
    () => upcomingEvents(ipos, todayIso, 14),
    [ipos, todayIso],
  );

  // 各銘柄のスコア・データ充足度を計算（設定変更で再計算）。
  const scored = useMemo<TopPickItem[]>(() => {
    return ipos.map((ipo) => {
      const result = scoreIpo(ipo, settings);
      return {
        ipo,
        supply: result.supplyDemand.score,
        funda: result.fundamental.score,
        overall: overallScore(result),
        completeness: assessCompleteness(ipo).level,
      };
    });
  }, [ipos, settings]);

  const picks = useMemo(
    () => topPicks(scored, 3, (ipo) => assessCompleteness(ipo)),
    [scored],
  );

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-bold text-text">ホーム</h1>
        <ScoreNote className="mt-1" />
      </div>

      <SentimentBanner
        sentiment={effectiveSentiment}
        mode={sentimentMode}
        market={market}
        className="mb-4"
      />

      <Section title="サマリー" note="直近90日の実績を機械的に集計した値です">
        <KpiGrid kpis={kpis} />
      </Section>

      <Section title="今後14日の予定" note="BB開始・抽選・購入期間・上場の日付順">
        <EventTimeline events={events} />
      </Section>

      <Section
        title="スコア上位ピックアップ"
        note="総合スコアの機械的な上位（参考情報。データ十分な銘柄のみ）"
      >
        <TopPicks items={picks} watched={isWatched} onToggleWatch={toggle} />
      </Section>

      <SupplyDemandHighlights
        ipos={ipos}
        settings={settings}
        todayIso={todayIso}
        watched={isWatched}
        onToggleWatch={toggle}
        className="mb-6"
      />

      <Disclaimer />
    </div>
  );
}
