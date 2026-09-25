import { getAllIpos, getMarketData } from "@/lib/repository";
import { IpoListClient } from "@/components/IpoListClient";

export default async function HomePage() {
  const [ipos, market] = await Promise.all([getAllIpos(), getMarketData()]);
  return <IpoListClient ipos={ipos} market={market} />;
}
