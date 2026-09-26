import { getAllIpos, getMarketData } from "@/lib/repository";
import { HomeClient } from "@/components/home/HomeClient";

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
export const dynamic = "force-dynamic";

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function HomePage() {
  const [ipos, market] = await Promise.all([getAllIpos(), getMarketData()]);
  const todayIso = todayIsoUtc();

  return <HomeClient ipos={ipos} market={market} todayIso={todayIso} />;
}
