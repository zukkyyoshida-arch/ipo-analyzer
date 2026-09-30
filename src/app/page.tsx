import { getAllIpos, getHistoricalIpos, getHotData, getMarketData } from "@/lib/repository";
import { jstTodayIso } from "@/lib/date";
import { HomeClient } from "@/components/home/HomeClient";
import { parseHomeTab } from "@/lib/home/tabs";
import { PICK_METHOD_PARAM, defaultPickMethod, parsePickMethod } from "@/lib/home/picks";
import { buildBbPickInputs, countBbOpen } from "@/lib/picks/bb";

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
// ピックアップの中の手法は ?m=（bb / secondary / holdings / yutai）で直接開ける（例: /?tab=hot&m=bb）。
// 未指定は、BB を受け付けている銘柄があれば BB、無ければセカンダリー。
// 初期タブ・初期の手法はここ（サーバー）で決めて渡し、サーバーとクライアントの初回描画を揃える。
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  const [ipos, market, hot, history, query] = await Promise.all([
    getAllIpos(),
    getMarketData(),
    getHotData(),
    getHistoricalIpos(),
    searchParams ?? Promise.resolve({} as { [key: string]: string | string[] | undefined }),
  ]);
  const todayIso = jstTodayIso();
  const initialTab = parseHomeTab(query.tab);
  // BB の対象（受付中・受付前）と材料。主幹事の実績・公募割れ確率は銘柄詳細と同じ作り方で、
  // 履歴はここ（サーバー）だけで使い、クライアントへは対象銘柄の結果だけを渡す。
  const bbPicks = buildBbPickInputs(ipos, history, todayIso);
  const initialMethod = parsePickMethod(
    query[PICK_METHOD_PARAM],
    defaultPickMethod(countBbOpen(bbPicks)),
  );

  return (
    <HomeClient
      // 同じホームのまま ?tab=・?m= だけ変わる遷移でも、そのタブ・手法で開き直す。
      key={`${initialTab}:${initialMethod}`}
      ipos={ipos}
      market={market}
      todayIso={todayIso}
      hot={hot}
      initialTab={initialTab}
      bbPicks={bbPicks}
      initialMethod={initialMethod}
    />
  );
}
