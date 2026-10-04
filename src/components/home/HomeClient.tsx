"use client";

import { useMemo, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import type { HotFile } from "@/lib/hot/file";
import type { MidFile } from "@/lib/midterm/file";
import { Disclaimer, ScoreNote } from "@/components/Disclaimer";
import { SentimentBanner } from "@/components/SentimentBanner";
import { SupplyDemandHighlights } from "@/components/SupplyDemandHighlights";
import { useSettings } from "@/hooks/useSettings";
import { useWatchlist } from "@/hooks/useUserData";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { scoreIpo, overallScore } from "@/lib/scoring";
import { assessCompleteness } from "@/lib/completeness";
import { upcomingEvents, topPicks } from "@/lib/home";
import {
  buildSeries,
  computeMetrics,
  dailyCounts,
  granularityFor,
  isBbOpen,
  isPeriodKey,
  listedIn,
  periodLabel,
  periodWindows,
  rankByInitialReturn,
  type MetricKey,
  type PeriodKey,
} from "@/lib/analytics";
import { STATUS_LABELS, formatDate } from "@/lib/format";
import { TopTabs } from "@/components/analytics/TopTabs";
import { PeriodSelector } from "@/components/analytics/PeriodSelector";
import { MetricChartCard } from "@/components/analytics/MetricChartCard";
import { RankingList } from "@/components/analytics/RankingList";
import { BbWeekCard } from "@/components/analytics/BbWeekCard";
import { signed } from "@/components/analytics/format";
import { HotRankingPanel } from "@/components/hot/HotRankingPanel";
import { Segmented } from "@/components/ui/Segmented";
import { BbPicksPanel } from "@/components/picks/BbPicksPanel";
import { HoldingsPanel } from "@/components/picks/HoldingsPanel";
import { YutaiPanel } from "@/components/picks/YutaiPanel";
import { DEFAULT_HOME_TAB, HOME_TABS, type HomeTab } from "@/lib/home/tabs";
import { PICK_METHODS, type PickMethod } from "@/lib/home/picks";
import { rankBbPicks, type BbPickInput } from "@/lib/picks/bb";
import { rankShortSecondary, type ShortSecondaryInput } from "@/lib/picks/shortSecondary";
import type { CheckpointEnriched } from "@/lib/checkpoints/types";
import { ShortSecondaryPanel } from "@/components/picks/ShortSecondaryPanel";
import { pickHoldingsMethod, type HoldingsMethodResult } from "@/lib/picks/holdings";
import { MidSecondaryPanel } from "@/components/picks/MidSecondaryPanel";
import { freshFins, freshMargin, rankMidSecondary } from "@/lib/picks/midSecondary";
import { useMidManual } from "@/hooks/useMidManual";
import type { FinsFile } from "@/types/fins";
import type { MarginFile } from "@/types/margin";
import type { ForeignFile } from "@/types/foreign";
import { TradeCalendarPanel } from "@/components/calendar/TradeCalendarPanel";
import { useManualEvents } from "@/hooks/useManualEvents";
import { EventTimeline } from "./EventTimeline";
import { computeBbCandidates } from "./BbCandidates";

/** bbPicks 未指定時の既定（毎回新しい配列を作ると useMemo が毎回計算し直すため）。 */
const NO_BB_PICKS: BbPickInput[] = [];
const NO_SHORT_PICKS: ShortSecondaryInput[] = [];
const NO_ENRICHED: Record<string, CheckpointEnriched> = {};
/** 上部のタブ（TopTabs は書き換え可能な配列を受け取るため、定数の写しを一度だけ作る）。 */
const TAB_OPTIONS = [...HOME_TABS];

function shortDate(iso: string): string {
  return iso ? formatDate(iso).slice(5) : "未定";
}

/**
 * ホーム（IPO アナリティクス）画面のクライアント本体。
 * 「今日」はページ（Server Component）が計算して渡す todayIso を使い、クライアントで Date.now を呼ばない。
 * 上部のタブは「ピックアップ・売買カレンダー・概要・今後の予定・実績」。開いたときはピックアップ。
 * 売買カレンダーの手動の予定は端末の localStorage だけで持つ。
 * ピックアップの中は手法の切り替え（BB・短期セカンダリ・中長期セカンダリ・大量保有・優待）。
 * initialTab・initialMethod はページが URL の ?tab=・?m= から決めて渡す（サーバーとクライアントで同じ初期表示になる）。
 * hot は hot.json（無ければ null。中長期セカンダリの中に「更新待ち」を出す）。
 * midterm は midterm.json（中長期セカンダリの候補の材料。無ければ null で「更新待ち」）。
 * fins・margin・foreign は J-Quants 財務・JPX 信用残・有報の外国法人等比率（中長期セカンダリの銘柄分だけ。古ければ該当チェックは不明）。
 * bbPicks はページが作った BB の対象と材料（スコアは設定の地合いを反映してここで付ける）。
 * shortPicks は短期セカンダリの対象と予想初値、checkpointEnriched は共通チェックに使う補完データ
 * （しきい値は設定の値をここで当てる）。
 * initialYutaiMonth は優待（先回り買い）で最初に開く権利確定月（データはブラウザが月別の静的ファイルを取る）。
 * holdingsPicks は大量保有の「今日」「直近 1 週間」の結果（ページが holdings.json から作る。未指定は空）。
 */
export function HomeClient({
  ipos,
  market,
  todayIso,
  hot = null,
  midterm = null,
  fins = null,
  margin = null,
  foreign = null,
  initialTab = DEFAULT_HOME_TAB,
  bbPicks: bbPickInputs = NO_BB_PICKS,
  shortPicks: shortPickInputs = NO_SHORT_PICKS,
  checkpointEnriched = NO_ENRICHED,
  initialMethod = "mid",
  holdingsPicks,
  initialYutaiMonth = 1,
}: {
  ipos: Ipo[];
  market: MarketData;
  todayIso: string;
  hot?: HotFile | null;
  midterm?: MidFile | null;
  fins?: FinsFile | null;
  margin?: MarginFile | null;
  foreign?: ForeignFile | null;
  initialTab?: HomeTab;
  bbPicks?: BbPickInput[];
  shortPicks?: ShortSecondaryInput[];
  checkpointEnriched?: Record<string, CheckpointEnriched>;
  initialMethod?: PickMethod;
  holdingsPicks?: { today: HoldingsMethodResult; week: HoldingsMethodResult };
  initialYutaiMonth?: number;
}) {
  const { settings, effectiveSentiment, sentimentMode, thresholds } = useSettings(market.sentiment);
  const { isWatched, toggle } = useWatchlist();

  const [tab, setTab] = useState<HomeTab>(initialTab);
  const manualEvents = useManualEvents();
  // 手法はここで持つ（ピックアップ以外のタブへ移って戻っても同じ手法のまま）。
  const [method, setMethod] = useState<PickMethod>(initialMethod);
  const [storedPeriod, setPeriod] = useLocalStorage<PeriodKey>("home.analytics.period", "90");
  const period: PeriodKey = isPeriodKey(storedPeriod) ? storedPeriod : "90";
  const [metric, setMetric] = useState<MetricKey>("avgReturn");

  const { current: curWin, previous: prevWin } = useMemo(
    () => periodWindows(period, todayIso, ipos),
    [period, todayIso, ipos],
  );
  const current = useMemo(() => computeMetrics(listedIn(ipos, curWin)), [ipos, curWin]);
  const previous = useMemo(
    () => (prevWin ? computeMetrics(listedIn(ipos, prevWin)) : null),
    [ipos, prevWin],
  );
  const granularity = granularityFor(curWin);
  const series = useMemo(
    () => buildSeries(ipos, curWin, granularity),
    [ipos, curWin, granularity],
  );

  const events = useMemo(() => upcomingEvents(ipos, todayIso, 14), [ipos, todayIso]);
  const bbOpenCount = useMemo(
    () => ipos.filter((ipo) => isBbOpen(ipo, todayIso)).length,
    [ipos, todayIso],
  );
  const daily = useMemo(
    () => dailyCounts(events.map((e) => e.date), todayIso, 14),
    [events, todayIso],
  );

  const scored = useMemo(
    () =>
      ipos.map((ipo) => {
        const result = scoreIpo(ipo, settings);
        return { ipo, overall: overallScore(result) };
      }),
    [ipos, settings],
  );
  const picks = useMemo(() => topPicks(scored, 5, (ipo) => assessCompleteness(ipo)), [scored]);
  const bbCandidates = useMemo(() => computeBbCandidates(ipos, settings, 5), [ipos, settings]);
  const bbPicks = useMemo(
    () => rankBbPicks(ipos, bbPickInputs, settings, { enrichedByCode: checkpointEnriched, thresholds }),
    [ipos, bbPickInputs, settings, checkpointEnriched, thresholds],
  );
  const shortPicks = useMemo(
    () => rankShortSecondary(ipos, shortPickInputs, checkpointEnriched, thresholds, todayIso),
    [ipos, shortPickInputs, checkpointEnriched, thresholds, todayIso],
  );
  const { manual: midManual, setVerdict: setMidVerdict } = useMidManual();
  const midPicks = useMemo(
    () => rankMidSecondary(ipos, midterm, checkpointEnriched, todayIso, { fins, margin, foreign, manual: midManual, thresholds }),
    [ipos, midterm, checkpointEnriched, todayIso, fins, margin, foreign, midManual, thresholds],
  );
  const holdings = useMemo(
    () =>
      holdingsPicks ?? {
        today: pickHoldingsMethod(null, todayIso, "today"),
        week: pickHoldingsMethod(null, todayIso, "week"),
      },
    [holdingsPicks, todayIso],
  );

  const ranked = useMemo(() => rankByInitialReturn(ipos, curWin), [ipos, curWin]);
  const topReturns = ranked.slice(0, 5);
  const bottomReturns = ranked.slice(-5).reverse().filter((r) => !topReturns.includes(r));

  const label = periodLabel(period);
  const headline =
    current.count === 0 ? (
      <>
        {label}に上場した銘柄はありません
      </>
    ) : current.avgReturn === null ? (
      <>
        {label}に上場したのは <span className="font-medium">{current.count} 社</span>です
      </>
    ) : (
      <>
        {label}に上場した <span className="font-medium">{current.count} 社</span>
        の初値騰落率は平均{" "}
        <span className="font-medium">{signed(current.avgReturn)}%</span> でした
      </>
    );

  const bbRanking = (
    <RankingList
      title="BB 参加候補"
      column="BB スコア"
      empty="受付前・受付中で条件に合う銘柄はありません"
      items={bbCandidates.map(({ ipo, bbScore }) => ({
        ipo,
        sub: `${STATUS_LABELS[ipo.status]} · BB ${shortDate(ipo.bbPeriod.start)}〜${shortDate(ipo.bbPeriod.end)}`,
        value: bbScore.toFixed(0),
      }))}
      detailHref="/bb"
      watched={isWatched}
      onToggleWatch={toggle}
    />
  );

  const scoreRanking = (
    <RankingList
      title="スコア上位"
      column="総合スコア"
      empty="データが十分な銘柄はまだありません"
      items={picks.map(({ ipo, overall }) => ({
        ipo,
        sub: `${ipo.market} · 上場 ${shortDate(ipo.listingDate)}`,
        value: overall.toFixed(0),
      }))}
      detailHref="/ipos"
      watched={isWatched}
      onToggleWatch={toggle}
    />
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="whitespace-nowrap pt-1 text-[22px] font-medium text-text">IPO アナリティクス</h1>
        <PeriodSelector value={period} range={curWin} onChange={setPeriod} />
      </div>

      <TopTabs options={TAB_OPTIONS} value={tab} onChange={setTab} className="mt-2" />

      {tab === "hot" ? (
        <div className="mt-3">
          <Segmented options={[...PICK_METHODS]} value={method} onChange={setMethod} />
          <div className="mt-4">
            {method === "bb" ? <BbPicksPanel picks={bbPicks} /> : null}
            {method === "short" ? <ShortSecondaryPanel picks={shortPicks} thresholds={thresholds} /> : null}
            {method === "mid" ? (
              // 注目度（いま熱い銘柄）の下に、大きく下げた銘柄の反発狙い（中長期セカンダリの候補）を並べる。
              <div className="space-y-4">
                <HotRankingPanel hot={hot} todayIso={todayIso} />
                <MidSecondaryPanel
                  picks={midPicks}
                  file={midterm}
                  todayIso={todayIso}
                  finsAsOf={freshFins(fins, todayIso)?.asOf ?? null}
                  marginAsOf={freshMargin(margin, todayIso)?.asOf ?? null}
                  onManual={setMidVerdict}
                />
              </div>
            ) : null}
            {method === "holdings" ? <HoldingsPanel today={holdings.today} week={holdings.week} /> : null}
            {method === "yutai" ? (
              <YutaiPanel initialMonth={initialYutaiMonth} todayIso={todayIso} />
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "calendar" ? (
        <div className="mt-4">
          <TradeCalendarPanel
            todayIso={todayIso}
            events={manualEvents.events}
            onSave={manualEvents.saveEvent}
            onRemove={manualEvents.removeEvent}
          />
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
          <div className="min-w-0">
            <p className="text-xl leading-snug text-text">{headline}</p>
            <SentimentBanner
              sentiment={effectiveSentiment}
              mode={sentimentMode}
              market={market}
              className="mt-3"
            />
            <div className="mt-4">
              <MetricChartCard
                current={current}
                previous={previous}
                series={series}
                granularity={granularity}
                selected={metric}
                onSelect={setMetric}
                detailHref="/ipos"
              />
            </div>
          </div>
          <div className="mt-4 space-y-4 lg:mt-0">
            <BbWeekCard openCount={bbOpenCount} daily={daily} />
            {bbRanking}
            {scoreRanking}
          </div>
        </div>
      ) : null}

      {tab === "upcoming" ? (
        <div className="mt-5 space-y-4">
          <EventTimeline events={events} />
          {bbRanking}
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="mt-5 space-y-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
          <RankingList
            title="初値騰落率 上位"
            column="初値騰落率"
            empty="この期間に初値がついた銘柄はありません"
            items={topReturns.map(({ ipo, rate }) => ({
              ipo,
              sub: `${ipo.market} · 上場 ${shortDate(ipo.listingDate)}`,
              value: <span className={rate >= 0 ? "text-up" : "text-down"}>{signed(rate)}%</span>,
            }))}
            detailHref="/ipos"
          />
          <RankingList
            title="初値騰落率 下位"
            column="初値騰落率"
            empty="該当する銘柄はありません"
            items={bottomReturns.map(({ ipo, rate }) => ({
              ipo,
              sub: `${ipo.market} · 上場 ${shortDate(ipo.listingDate)}`,
              value: <span className={rate >= 0 ? "text-up" : "text-down"}>{signed(rate)}%</span>,
            }))}
          />
          <SupplyDemandHighlights
            ipos={ipos}
            settings={settings}
            todayIso={todayIso}
            watched={isWatched}
            onToggleWatch={toggle}
          />
        </div>
      ) : null}

      <div className="mt-8">
        <ScoreNote />
        <Disclaimer />
      </div>
    </div>
  );
}
