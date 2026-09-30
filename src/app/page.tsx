import { getAllIpos, getHotData, getMarketData } from "@/lib/repository";
import { jstTodayIso } from "@/lib/date";
import { HomeClient } from "@/components/home/HomeClient";
import { parseHomeTab } from "@/lib/home/tabs";

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
// 上部のタブは URL の ?tab=（hot / overview / upcoming / results）で直接開ける。未指定は注目度（hot）。
// 初期タブはここ（サーバー）で決めて渡し、サーバーとクライアントの初回描画を揃える。
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  const [ipos, market, hot, query] = await Promise.all([
    getAllIpos(),
    getMarketData(),
    getHotData(),
    searchParams ?? Promise.resolve({} as { [key: string]: string | string[] | undefined }),
  ]);
  const todayIso = jstTodayIso();
  const initialTab = parseHomeTab(query.tab);

  return (
    <HomeClient
      // 同じホームのまま ?tab= だけ変わる遷移でも、そのタブで開き直す。
      key={initialTab}
      ipos={ipos}
      market={market}
      todayIso={todayIso}
      hot={hot}
      initialTab={initialTab}
    />
  );
}
