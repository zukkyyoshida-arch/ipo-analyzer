import { getAllIpos, getMarketData } from "@/lib/repository";
import { HomeClient } from "@/components/home/HomeClient";

// ホーム（Market Radar）は「今日」に依存する集計（直近90日KPI・今後14日イベント）を
// 含むため、既存の詳細ページの SSG（generateStaticParams）とは整合させず、
// このページのみ短い ISR（5分）で再生成する。「今日」はここ（サーバー）で計算し、
// props として渡すことでクライアントの Date.now 依存・ハイドレーション不整合を避ける。
export const revalidate = 300;

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function HomePage() {
  const [ipos, market] = await Promise.all([getAllIpos(), getMarketData()]);
  const todayIso = todayIsoUtc();

  return <HomeClient ipos={ipos} market={market} todayIso={todayIso} />;
}
