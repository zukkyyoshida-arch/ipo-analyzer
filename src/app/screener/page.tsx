import { getAllIpos, getMarketData } from "@/lib/repository";
import { jstTodayIso } from "@/lib/date";
import { ScreenerClient } from "@/components/screener/ScreenerClient";

export default async function ScreenerPage() {
  const [ipos, market] = await Promise.all([getAllIpos(), getMarketData()]);
  // 「上場から N 日以内」の基準日。初回描画をサーバーと揃えるため props で渡し、
  // マウント後にクライアントで日本時間の今日へ更新する（ScreenerClient 側）。
  return <ScreenerClient ipos={ipos} market={market} todayIso={jstTodayIso()} />;
}
