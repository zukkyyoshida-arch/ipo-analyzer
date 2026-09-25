import { getAllIpos, getMarketData } from "@/lib/repository";
import { ScreenerClient } from "@/components/screener/ScreenerClient";

export default async function ScreenerPage() {
  const [ipos, market] = await Promise.all([getAllIpos(), getMarketData()]);
  return <ScreenerClient ipos={ipos} market={market} />;
}
