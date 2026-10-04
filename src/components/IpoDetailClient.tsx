"use client";

import { useMemo } from "react";
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { MarketData } from "@/types/data";
import type { IpoEnriched } from "@/types/enriched";
import { useSettings } from "@/hooks/useSettings";
import { useBbState, useWatchlist } from "@/hooks/useUserData";
import { scoreIpo } from "@/lib/scoring";
import { scoreBbParticipation, type BbScoreContext } from "@/lib/scoring/bb";
import type { BreakEvenProbability } from "@/lib/scoring/bbProbability";
import type { OutcomeByPeriod, UnderwriterBreakEvenStat } from "@/lib/stats";
import { assessCompleteness } from "@/lib/completeness";
import { Chip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
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
import { OutcomeDistribution } from "@/components/detail/OutcomeDistribution";
import { UnderwriterPriority } from "@/components/detail/UnderwriterPriority";
import { BbScoreBreakdown } from "@/components/detail/BbScoreBreakdown";
import { EnrichedInfo } from "@/components/detail/EnrichedInfo";
import { BbProbabilityCard } from "@/components/detail/BbProbabilityCard";
import { ExternalLinks } from "@/components/detail/ExternalLinks";
import { SecondaryCard } from "@/components/detail/SecondaryCard";
import type { InitialForecast } from "@/lib/secondary/initialForecast";
import { STATUS_LABELS } from "@/lib/format";
import { CheckpointCard } from "@/components/detail/CheckpointCard";
import { MidCheckCard, type MidDetailInput } from "@/components/detail/MidCheckCard";
import { useMidManual } from "@/hooks/useMidManual";

export function IpoDetailClient({
  ipo,
  brokers,
  similarIpos,
  market,
  underwriterStat,
  outcome,
  enriched,
  todayIso,
  bbContext,
  breakEvenProbability,
  initialForecast = null,
  midInput = null,
}: {
  ipo: Ipo;
  brokers: Broker[];
  similarIpos: Ipo[];
  market: MarketData;
  /** 主幹事の公募割れ統計（自身を除く・サーバー側で集計）。母数0なら null。 */
  underwriterStat: UnderwriterBreakEvenStat | null;
  /** 類似条件（吸収金額帯×市場）の初値実績分布。直近3年・全期間（サーバー側で集計）。 */
  outcome: OutcomeByPeriod;
  enriched?: IpoEnriched;
  /** サーバー側で確定した今日（YYYY-MM-DD）。 */
  todayIso: string;
  /** 直近IPOの初値動向・同週上場件数（全銘柄からサーバー側で算出）。 */
  bbContext: BbScoreContext;
  /** 公募割れ確率（実績ベース）。算出できない銘柄は null。 */
  breakEvenProbability: BreakEvenProbability | null;
  /** 予想初値（サーバー側で算出）。公開価格が無い銘柄は null。 */
  initialForecast?: InitialForecast | null;
  /** 中長期チェックの材料（中長期セカンダリの母集団に無い銘柄は null でカードを出さない）。 */
  midInput?: MidDetailInput | null;
}) {
  const { settings, thresholds } = useSettings(market.sentiment);
  const { manual: midManual, setVerdict: setMidVerdict } = useMidManual();
  const { isWatched, toggle } = useWatchlist();
  const { bbState, hydrated: bbHydrated } = useBbState();

  const completeness = useMemo(() => assessCompleteness(ipo), [ipo]);
  const score = useMemo(() => scoreIpo(ipo, settings), [ipo, settings]);
  const showScore = completeness.level !== "insufficient";
  // BB参加スコア。主幹事実績は page.tsx で自身を除いて集計済み（上場済み銘柄の結果リーク回避）。
  const bbScore = useMemo(
    () => scoreBbParticipation(ipo, settings, underwriterStat, undefined, bbContext),
    [ipo, settings, underwriterStat, bbContext],
  );

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

  // 実在するセクションだけをジャンプ先にする（スコアは showScore のときのみ）。
  const jumpChips = [
    { id: "price", label: "価格" },
    { id: "secondary", label: "セカンダリー" },
    ...(showScore ? [{ id: "score", label: "スコア" }] : []),
    { id: "basic", label: "基本情報" },
    { id: "bb", label: "BB" },
    { id: "check", label: "チェック" },
    { id: "memo", label: "メモ" },
  ];

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[11px] font-medium text-muted">
            {ipo.code}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-medium text-text">{ipo.name}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span>{ipo.market}</span>
              <span>{STATUS_LABELS[ipo.status]}</span>
            </div>
          </div>
          <WatchStar active={isWatched(ipo.code)} onToggle={() => toggle(ipo.code)} />
        </div>
        {completeness.level === "insufficient" ? (
          <div className="mt-2">
            <Chip tone="warn">基本情報 未取得</Chip>
          </div>
        ) : null}
      </div>

      <nav aria-label="セクションへ移動" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {jumpChips.map((c) => (
          <a
            key={c.id}
            href={`#${c.id}`}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-surface px-4 text-xs font-medium text-text active:opacity-80"
          >
            {c.label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        <Section id="price" title="価格">
          <PriceCard ipo={ipo} todayIso={todayIso} />
        </Section>

        <Section id="secondary" title="セカンダリー" note="予想初値と、初値を基準にした線（参考情報）">
          <SecondaryCard ipo={ipo} forecast={initialForecast} todayIso={todayIso} />
        </Section>

        {showScore ? (
          <Section title="類似条件の初値実績">
            <OutcomeDistribution ipo={ipo} outcome={outcome} />
          </Section>
        ) : null}

        {showScore ? (
          <Section id="score" title="スコア" action={<ScoreNote />}>
            <ScoreGauges score={score} bbScore={bbScore.score} />
          </Section>
        ) : null}

        {showScore ? (
          <Section title="公募割れ確率">
            <BbProbabilityCard result={breakEvenProbability} />
          </Section>
        ) : null}

        {showScore ? (
          <Section title="スコア内訳">
            <div className="space-y-4">
              <Disclosure summary="需給スコアの内訳">
                <div className="mt-2">
                  <ScoreBreakdown title="需給スコア" axis={score.supplyDemand} />
                </div>
              </Disclosure>
              <Disclosure summary="ファンダスコアの内訳">
                <div className="mt-2">
                  <ScoreBreakdown title="ファンダスコア" axis={score.fundamental} />
                </div>
              </Disclosure>
              <Disclosure summary="BB参加スコアの内訳">
                <div className="mt-2">
                  <BbScoreBreakdown bbScore={bbScore} />
                </div>
              </Disclosure>
            </div>
          </Section>
        ) : null}

        <Section id="basic" title="基本情報">
          <BasicInfoList ipo={ipo} />
        </Section>

        <Section title="会社概要・業績・大株主" note="補完データ（出典・取得日時つき）">
          <EnrichedInfo enriched={enriched} />
        </Section>

        <Section
          title="幹事団と申込優先順位"
          note="幹事配分×抽選方式から算出した参考順位です"
        >
          <UnderwriterPriority
            ipo={ipo}
            brokers={brokers}
            allocations={enriched?.underwriterAllocations}
          />
        </Section>

        <Section title="日程">
          <Timeline ipo={ipo} />
        </Section>

        {collapseBbSection ? (
          <Section id="bb" title="BB申込状況">
            <Disclosure muted summary="申込記録なし（タップで表示）">
              <div className="mt-2">
                <BbStatusList ipo={ipo} brokers={brokers} />
              </div>
            </Disclosure>
          </Section>
        ) : (
          <Section id="bb" title="BB申込状況">
            <BbStatusList ipo={ipo} brokers={brokers} />
          </Section>
        )}

        <div id="check" className="scroll-mt-32">
          <CheckpointCard ipo={ipo} enriched={enriched} thresholds={thresholds} />
        </div>

        {midInput ? (
          <MidCheckCard
            ipo={ipo}
            enriched={enriched}
            input={midInput}
            thresholds={thresholds}
            todayIso={todayIso}
            manual={midManual[ipo.code]}
            onManual={setMidVerdict}
          />
        ) : null}

        <InvestmentChecklist ipo={ipo} />

        {similarIpos.length > 0 ? (
          <Section title="類似IPO">
            <SimilarIpos ipos={similarIpos} settings={settings} />
          </Section>
        ) : null}

        <Section title="一次情報リンク" note="外部サイトが新しいタブで開きます">
          <ExternalLinks code={ipo.code} articleUrl={enriched?.articleUrl} />
        </Section>

        <Section id="memo" title="メモ">
          <NotesEditor code={ipo.code} />
        </Section>
      </div>
    </div>
  );
}
