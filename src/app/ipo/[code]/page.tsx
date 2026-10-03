import { notFound } from "next/navigation";
import {
  getAllIpos,
  getIpoByCode,
  getDefaultBrokers,
  getMarketData,
  getEnrichedByCode,
  getHistoricalIpos,
  getMidtermData,
  getFinsData,
  getMarginData,
  getForeignData,
} from "@/lib/repository";
import { freshFins, freshMargin } from "@/lib/picks/midSecondary";
import { freshForeignItem } from "@/lib/foreign/file";
import type { MidDetailInput } from "@/components/detail/MidCheckCard";
import { IpoDetailClient } from "@/components/IpoDetailClient";
import { Disclaimer } from "@/components/Disclaimer";
import { outcomeByPeriod } from "@/lib/stats";
import { combineOutcomeSources, ipoToOutcomeSource } from "@/lib/stats/history";
import { jstTodayIso } from "@/lib/date";
import { buildBbInputs } from "@/lib/scoring/bbInputs";
import { buildRecentPool, forecastInitialPrice } from "@/lib/secondary/initialForecast";

// 新規発見銘柄（ビルド時に未知）でも再ビルドなしで表示できるよう動的パラメータを許可。
export const dynamicParams = true;

export async function generateStaticParams() {
  const ipos = await getAllIpos();
  return ipos.map((ipo) => ({ code: ipo.code }));
}


export default async function IpoDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [ipo, brokers, market, allIpos, enriched, history, midterm, finsAll, marginAll, foreignAll] = await Promise.all([
    getIpoByCode(code),
    Promise.resolve(getDefaultBrokers()),
    getMarketData(),
    getAllIpos(),
    getEnrichedByCode(code),
    getHistoricalIpos(),
    getMidtermData(),
    getFinsData(),
    getMarginData(),
    getForeignData(),
  ]);
  if (!ipo) notFound();

  // 類似IPO（重複と自身を除外）。
  const byCode = new Map(allIpos.map((i) => [i.code, i]));
  const similarIpos = Array.from(new Set(ipo.similarIpoCodes))
    .filter((c) => c !== ipo.code)
    .map((c) => byCode.get(c))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  // 統計はサーバー側で集計し、結果だけをクライアントへ渡す（全銘柄・履歴を埋め込まない）。
  // 母数は現行データ＋履歴（2015〜2023）。
  const todayIso = jstTodayIso();
  const sources = combineOutcomeSources(allIpos, history);
  const target = ipoToOutcomeSource(ipo);
  // BB参加スコア用の主幹事実績（直近3年・自身を除く）、直近IPOの初値動向（上場日より前の5件）・
  // 同週上場件数と、公募割れ確率（実績ベース）。ホームのピックアップ（BB）と同じ作り方にする。
  const { underwriterStat, bbContext, breakEvenProbability } = buildBbInputs(
    ipo,
    allIpos,
    sources,
    todayIso,
  );
  const outcome = outcomeByPeriod(sources, target, todayIso);
  // 予想初値（上場前の情報だけのリッジ回帰）。直近の初値騰落は現行データ＋履歴から上場日より前だけで計算する。
  const initialForecast = forecastInitialPrice(ipo, buildRecentPool(allIpos, history), enriched);
  // 中長期チェック（10 項目）。母集団（midterm.json）に入っている銘柄だけ。財務・信用残・外国法人等比率は古ければ不明扱い。
  const midItem = midterm?.items.find((i) => i.code === ipo.code);
  const fins = freshFins(finsAll, todayIso);
  const margin = freshMargin(marginAll, todayIso);
  const midInput: MidDetailInput | null = midItem
    ? {
        item: midItem,
        fins: fins?.items[ipo.code] ?? null,
        margin: margin?.items[ipo.code] ?? null,
        foreign: freshForeignItem(foreignAll?.items[ipo.code], todayIso) ?? null,
        finsAsOf: fins?.asOf ?? null,
        marginAsOf: margin?.asOf ?? null,
      }
    : null;

  return (
    <div>
      <IpoDetailClient
        ipo={ipo}
        brokers={brokers}
        similarIpos={similarIpos}
        market={market}
        underwriterStat={underwriterStat}
        outcome={outcome}
        enriched={enriched}
        todayIso={todayIso}
        bbContext={bbContext}
        breakEvenProbability={breakEvenProbability}
        initialForecast={initialForecast}
        midInput={midInput}
      />
      <Disclaimer />
    </div>
  );
}
