import {
  getAllEnriched,
  getAllIpos,
  getHistoricalIpos,
  getHoldingsData,
  getHotData,
  getMarketData,
  getMidtermData,
} from "@/lib/repository";
import { jstTodayIso } from "@/lib/date";
import { HomeClient } from "@/components/home/HomeClient";
import { parseHomeTab } from "@/lib/home/tabs";
import { PICK_METHOD_PARAM, defaultPickMethod, parsePickMethod } from "@/lib/home/picks";
import { buildBbPickInputs, countBbOpen } from "@/lib/picks/bb";
import { buildShortSecondaryInputs } from "@/lib/picks/shortSecondary";
import { pickHoldingsMethod } from "@/lib/picks/holdings";
import { pickCheckpointEnriched, type CheckpointEnriched } from "@/lib/checkpoints/types";

// ホーム（Market Radar）は「今日」に依存する集計（直近90日KPI・今後14日イベント）を
// 含むため、既存の詳細ページの SSG（generateStaticParams）とは整合させず、
// このページのみ動的レンダリングにする。「今日」はここ（サーバー）で計算し、
// props として渡すことでクライアントの Date.now 依存・ハイドレーション不整合を避ける。
//
// 注: Cloudflare Workers（@opennextjs/cloudflare、Static Assets incremental cache構成）
// では ISR の時間経過による自動再検証（revalidate: 300 のような秒指定）が機能せず、
// 「ビルド時点の値を返す読み取り専用キャッシュ」になってしまう。これだと「今日」基準の
// KPI・今後14日イベントがデプロイ時点のまま固定表示され続けるため、revalidate指定ではなく
// dynamic = "force-dynamic" にしてリクエストごとに再計算する。
//
// 「今日」は日本時間（JST）の日付にする。Workers は UTC で動くため、UTC の日付をそのまま使うと
// JST の 0:00〜8:59 が前日扱いになり、朝に開くと「今後14日」が前日始まりになってしまう。
export const dynamic = "force-dynamic";

//
// 上部のタブは URL の ?tab=（hot / overview / upcoming / results）で直接開ける。未指定はピックアップ（hot）。
// ピックアップの中の手法は ?m=（bb / short / mid / holdings / yutai。以前の secondary は mid）で直接開ける
// （例: /?tab=hot&m=bb）。未指定は、BB を受け付けている銘柄があれば BB、上場前日〜上場 5 日目の銘柄があれば
// 短期セカンダリ、どちらも無ければ中長期セカンダリ。
// 初期タブ・初期の手法はここ（サーバー）で決めて渡し、サーバーとクライアントの初回描画を揃える。
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  const [ipos, market, hot, midterm, history, enriched, holdingsFile, query] = await Promise.all([
    getAllIpos(),
    getMarketData(),
    getHotData(),
    getMidtermData(),
    getHistoricalIpos(),
    getAllEnriched(),
    getHoldingsData(),
    searchParams ?? Promise.resolve({} as { [key: string]: string | string[] | undefined }),
  ]);
  const todayIso = jstTodayIso();
  const initialTab = parseHomeTab(query.tab);
  // BB の対象（受付中・受付前）と材料。主幹事の実績・公募割れ確率は銘柄詳細と同じ作り方で、
  // 履歴はここ（サーバー）だけで使い、クライアントへは対象銘柄の結果だけを渡す。
  const bbPicks = buildBbPickInputs(ipos, history, todayIso, enriched);
  // 短期セカンダリ（上場前日〜上場 5 日目）の対象と予想初値。予想の母集団（履歴）はサーバーだけで使う。
  const shortPicks = buildShortSecondaryInputs(ipos, history, enriched, todayIso);
  // 共通チェックに使う補完データ。対象銘柄の、チェックに使う項目だけを渡す。
  const checkpointEnriched: Record<string, CheckpointEnriched> = {};
  const enrichedByCode = new Map(enriched.map((e) => [e.code, e]));
  // 中長期セカンダリ（midterm.json の銘柄）も業績・発行済株式数・大株主のロックを使う。
  const midCodes = midterm?.items.map((item) => item.code) ?? [];
  for (const code of new Set([...bbPicks.map((p) => p.code), ...shortPicks.map((p) => p.code), ...midCodes])) {
    const picked = pickCheckpointEnriched(enrichedByCode.get(code));
    if (picked) checkpointEnriched[code] = picked;
  }
  // 大量保有（新規 5% 超・増加）。holdings.json 全体はサーバーだけで使い、クライアントへは選んだ結果だけを渡す。
  const holdingsPicks = {
    today: pickHoldingsMethod(holdingsFile, todayIso, "today"),
    week: pickHoldingsMethod(holdingsFile, todayIso, "week"),
  };
  const initialMethod = parsePickMethod(
    query[PICK_METHOD_PARAM],
    defaultPickMethod(countBbOpen(bbPicks), shortPicks.length),
  );

  return (
    <HomeClient
      // 同じホームのまま ?tab=・?m= だけ変わる遷移でも、そのタブ・手法で開き直す。
      key={`${initialTab}:${initialMethod}`}
      ipos={ipos}
      market={market}
      todayIso={todayIso}
      hot={hot}
      midterm={midterm}
      initialTab={initialTab}
      bbPicks={bbPicks}
      shortPicks={shortPicks}
      checkpointEnriched={checkpointEnriched}
      initialMethod={initialMethod}
      holdingsPicks={holdingsPicks}
    />
  );
}
