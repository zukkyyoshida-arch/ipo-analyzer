"use client";

import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { MarketData } from "@/types/data";
import { useSettings } from "@/hooks/useSettings";
import { useBbState, useWatchlist } from "@/hooks/useUserData";
import { scoreIpo } from "@/lib/scoring";
import { assessCompleteness } from "@/lib/completeness";
import { Chip } from "@/components/ui/Chip";
import { Section } from "@/components/ui/Section";
import { WatchStar } from "@/components/WatchStar";
import { ScoreNote } from "@/components/Disclaimer";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { InvestmentChecklist } from "@/components/InvestmentChecklist";
import { PriceCard } from "@/components/detail/PriceCard";
import { ScoreGauges } from "@/components/detail/ScoreGauges";
import { BasicInfoList } from "@/components/detail/BasicInfoList";
import { Timeline } from "@/components/detail/Timeline";
import { BbStatusList } from "@/components/detail/BbStatusList";
import { SimilarIpos } from "@/components/detail/SimilarIpos";
import { NotesEditor } from "@/components/detail/NotesEditor";
import { STATUS_LABELS } from "@/lib/format";

export function IpoDetailClient({
  ipo,
  brokers,
  similarIpos,
  market,
}: {
  ipo: Ipo;
  brokers: Broker[];
  similarIpos: Ipo[];
  market: MarketData;
}) {
  const { settings } = useSettings(market.sentiment);
  const { isWatched, toggle } = useWatchlist();
  const { bbState, hydrated: bbHydrated } = useBbState();

  const completeness = useMemo(() => assessCompleteness(ipo), [ipo]);
  const score = useMemo(() => scoreIpo(ipo, settings), [ipo, settings]);
  const showScore = completeness.level !== "insufficient";

  // 申込記録が1件でもあるか（status!=="none" またはメモ入力あり）。
  // hydration前（localStorage未読込）は判定できないため「記録あり」扱いにして
  // 展開表示のままにし、判定確定後に折りたたみへ切り替える（SSR/CSR不一致防止）。
  const hasAnyBbEntry = useMemo(() => {
    if (!bbHydrated) return true;
    const entries = bbState[ipo.code];
    if (!entries) return false;
    return Object.values(entries).some(
      (entry) => entry.status !== "none" || !!entry.memo?.trim(),
    );
  }, [bbHydrated, bbState, ipo.code]);

  // 上場済かつ申込記録が無い銘柄は「BB申込状況」を既定で折りたたむ。
  const collapseBbSection = ipo.status === "listed" && !hasAnyBbEntry;

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Chip tone="accent">{STATUS_LABELS[ipo.status]}</Chip>
              <span className="text-xs text-muted">{ipo.code}</span>
              <span className="text-xs text-muted">{ipo.market}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-text">{ipo.name}</h1>
          </div>
          <WatchStar active={isWatched(ipo.code)} onToggle={() => toggle(ipo.code)} />
        </div>
        {completeness.level === "insufficient" ? (
          <div className="mt-2">
            <Chip tone="warn">基本情報 未取得</Chip>
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <Section title="価格">
          <PriceCard ipo={ipo} />
        </Section>

        {showScore ? (
          <Section title="スコア" action={<ScoreNote />}>
            <ScoreGauges score={score} />
          </Section>
        ) : null}

        {showScore ? (
          <Section title="スコア内訳">
            <div className="space-y-4">
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-text marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block text-muted">▶</span>
                    需給スコアの内訳
                  </span>
                </summary>
                <div className="mt-2">
                  <ScoreBreakdown title="需給スコア" axis={score.supplyDemand} />
                </div>
              </details>
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-text marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block text-muted">▶</span>
                    ファンダスコアの内訳
                  </span>
                </summary>
                <div className="mt-2">
                  <ScoreBreakdown title="ファンダスコア" axis={score.fundamental} />
                </div>
              </details>
            </div>
          </Section>
        ) : null}

        <Section title="基本情報">
          <BasicInfoList ipo={ipo} />
        </Section>

        <Section title="日程">
          <Timeline ipo={ipo} />
        </Section>

        {collapseBbSection ? (
          <Section title="BB申込状況">
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-muted marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block">▶</span>
                  申込記録なし（タップで表示）
                </span>
              </summary>
              <div className="mt-2">
                <BbStatusList ipo={ipo} brokers={brokers} />
              </div>
            </details>
          </Section>
        ) : (
          <Section title="BB申込状況">
            <BbStatusList ipo={ipo} brokers={brokers} />
          </Section>
        )}

        <InvestmentChecklist ipo={ipo} />

        {similarIpos.length > 0 ? (
          <Section title="類似IPO">
            <SimilarIpos ipos={similarIpos} settings={settings} />
          </Section>
        ) : null}

        <Section title="メモ">
          <NotesEditor code={ipo.code} />
        </Section>
      </div>
    </div>
  );
}
