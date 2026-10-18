"use client";

import { useEffect, useMemo, type ReactNode } from "react";
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
import { CollapsibleSection, openCollapsibleAnchor } from "@/components/ui/CollapsibleSection";
import { VerdictBadge } from "@/components/detail/VerdictBadge";
import { DetailActionBar } from "@/components/detail/DetailActionBar";
import {
  DETAIL_PHASE_LABELS,
  determineDetailPhase,
  isPreListingPhase,
  nextDeadline,
} from "@/lib/checklist/phase";
import { pickVerdict, type PickVerdictInput } from "@/lib/picks/verdict";
import { runCommonCheckpoints } from "@/lib/checkpoints/common";

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
  const { settings, thresholds, myBrokers } = useSettings(market.sentiment);
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

  // フェーズ（BB前／BB中／抽選〜購入／上場当日／上場後）で並び順を切り替える。
  const phase = determineDetailPhase(ipo, todayIso);
  const preListing = isPreListingPhase(phase);
  const deadline = preListing ? nextDeadline(ipo, todayIso) : null;

  // 結論バッジの材料。✗ の数は「チェックポイント」カードと同じ判定から数える。
  const ngCount = useMemo(
    () => runCommonCheckpoints({ ipo, enriched }, thresholds).counts.fail,
    [ipo, enriched, thresholds],
  );
  // BB スコアが出せない銘柄は 0 扱い（参加候補にはならない）。ピックアップのカードと同じ判定関数を使う。
  const verdictInput: PickVerdictInput = {
    bbScore: showScore ? bbScore.score : 0,
    breakEvenProbability: breakEvenProbability ? breakEvenProbability.probability : null,
    failCount: ngCount,
  };
  const verdict = pickVerdict(verdictInput);

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
  // 公開価格が未定のうちは価格欄が「—」だらけなので畳む。
  const priceUndetermined = ipo.offeringPrice === null;

  // URL の #id で来たとき（他画面からのリンク・戻る）も、畳んだ Section を開いてから合わせる。
  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (openCollapsibleAnchor(id)) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  const sections: Record<string, { label?: string; node: ReactNode } | null> = {
    schedule: {
      label: "日程",
      node: (
        <Section id="schedule" title="日程">
          <Timeline ipo={ipo} deadline={deadline} />
        </Section>
      ),
    },
    bb: {
      label: "BB",
      node: collapseBbSection ? (
        <CollapsibleSection id="bb" title="BB申込状況" note="申込記録なし（タップで表示）">
          <BbStatusList ipo={ipo} brokers={brokers} allocations={enriched?.underwriterAllocations} myBrokers={myBrokers} />
        </CollapsibleSection>
      ) : (
        <Section id="bb" title="BB申込状況">
          <BbStatusList ipo={ipo} brokers={brokers} allocations={enriched?.underwriterAllocations} myBrokers={myBrokers} />
        </Section>
      ),
    },
    check: {
      label: "チェック",
      node: (
        <div id="check" className="scroll-mt-32">
          <CheckpointCard ipo={ipo} enriched={enriched} thresholds={thresholds} />
        </div>
      ),
    },
    // 表に出すのは公募割れ確率だけ。4ゲージと投資判断チェックリストは「根拠を見る」の中。
    score: {
      label: "スコア",
      node: (
        <Section id="score" title="スコア" action={showScore ? <ScoreNote /> : undefined}>
          <div className="space-y-3">
            {showScore ? (
              <div>
                <p className="mb-2 text-sm font-medium text-text">公募割れ確率</p>
                <BbProbabilityCard result={breakEvenProbability} />
              </div>
            ) : (
              <p className="text-sm text-muted">基本情報が未取得のため、スコアは出していません。</p>
            )}
            <Disclosure summary="根拠を見る（4スコア・投資判断チェックリスト）">
              <div className="mt-2 space-y-4">
                {showScore ? <ScoreGauges score={score} bbScore={bbScore.score} /> : null}
                <InvestmentChecklist ipo={ipo} />
              </div>
            </Disclosure>
          </div>
        </Section>
      ),
    },
    price: {
      label: "価格",
      node:
        preListing && priceUndetermined ? (
          <CollapsibleSection id="price" title="価格" note="公開価格は未定です">
            <PriceCard ipo={ipo} todayIso={todayIso} />
          </CollapsibleSection>
        ) : (
          <Section id="price" title="価格">
            <PriceCard ipo={ipo} todayIso={todayIso} />
          </Section>
        ),
    },
    secondary: {
      label: "セカンダリー",
      node: (
        <Section id="secondary" title="セカンダリー" note="予想初値と、初値を基準にした線（参考情報）">
          <SecondaryCard ipo={ipo} forecast={initialForecast} todayIso={todayIso} />
        </Section>
      ),
    },
    outcome: showScore
      ? {
          label: "類似実績",
          node: (
            <Section id="outcome" title="類似条件の初値実績">
              <OutcomeDistribution ipo={ipo} outcome={outcome} />
            </Section>
          ),
        }
      : null,
    basic: {
      label: "基本情報",
      node: (
        <Section id="basic" title="基本情報">
          <BasicInfoList ipo={ipo} />
        </Section>
      ),
    },
    mid: midInput
      ? {
          node: (
            <MidCheckCard
              ipo={ipo}
              enriched={enriched}
              input={midInput}
              thresholds={thresholds}
              todayIso={todayIso}
              manual={midManual[ipo.code]}
              onManual={setMidVerdict}
            />
          ),
        }
      : null,
    breakdown: showScore
      ? {
          label: "内訳",
          node: (
            <CollapsibleSection id="breakdown" title="スコア内訳">
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
            </CollapsibleSection>
          ),
        }
      : null,
    company: {
      label: "会社概要",
      node: (
        <CollapsibleSection id="company" title="会社概要・業績・大株主" note="補完データ（出典・取得日時つき）">
          <EnrichedInfo enriched={enriched} />
        </CollapsibleSection>
      ),
    },
    syndicate: {
      label: "幹事団",
      node: (
        <CollapsibleSection
          id="syndicate"
          title="幹事団と申込優先順位"
          note="幹事配分×抽選方式から算出した参考順位です"
        >
          <UnderwriterPriority ipo={ipo} brokers={brokers} allocations={enriched?.underwriterAllocations} />
        </CollapsibleSection>
      ),
    },
    similar:
      similarIpos.length > 0
        ? {
            label: "類似IPO",
            node: (
              <CollapsibleSection id="similar" title="類似IPO">
                <SimilarIpos ipos={similarIpos} settings={settings} />
              </CollapsibleSection>
            ),
          }
        : null,
    links: {
      label: "リンク",
      node: (
        <CollapsibleSection id="links" title="一次情報リンク" note="外部サイトが新しいタブで開きます">
          <ExternalLinks code={ipo.code} articleUrl={enriched?.articleUrl} />
        </CollapsibleSection>
      ),
    },
    memo: {
      label: "メモ",
      node: (
        <Section id="memo" title="メモ">
          <NotesEditor code={ipo.code} />
        </Section>
      ),
    },
  };

  // BB前〜購入: 日程 → BB → チェック → スコア → 価格 → 以下
  // 上場当日〜上場後: 価格 → セカンダリー → 類似実績 → スコア → 以下
  const order = preListing
    ? ["schedule", "bb", "check", "score", "price", "secondary", "outcome", "basic", "mid", "breakdown", "company", "syndicate", "similar", "links", "memo"]
    : ["price", "secondary", "outcome", "score", "bb", "check", "mid", "basic", "schedule", "breakdown", "company", "syndicate", "similar", "links", "memo"];
  const visible = order
    .map((id) => ({ id, section: sections[id] }))
    .filter((x): x is { id: string; section: { label?: string; node: ReactNode } } => x.section !== null);
  const jumpChips = visible
    .filter((x) => x.section.label)
    .map((x) => ({ id: x.id, label: x.section.label as string }));

  return (
    <div className="pb-16">
      {/* ヘッダー */}
      <div className="mb-4">
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
        {preListing ? (
          <div className="mt-3">
            <VerdictBadge verdict={verdict} phaseLabel={DETAIL_PHASE_LABELS[phase]} input={verdictInput} />
          </div>
        ) : null}
      </div>

      <nav aria-label="セクションへ移動" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {jumpChips.map((c) => (
          <a
            key={c.id}
            href={`#${c.id}`}
            onClick={() => openCollapsibleAnchor(c.id)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-surface px-4 text-xs font-medium text-text active:opacity-80"
          >
            {c.label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {visible.map((x) => (
          <div key={x.id}>{x.section.node}</div>
        ))}
      </div>

      <DetailActionBar watched={isWatched(ipo.code)} onToggleWatch={() => toggle(ipo.code)} />
    </div>
  );
}
