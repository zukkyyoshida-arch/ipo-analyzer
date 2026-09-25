import { getDefaultBrokers, getMarketData } from "@/lib/repository";
import { SettingsClient } from "@/components/SettingsClient";

export default async function SettingsPage() {
  const brokers = getDefaultBrokers();
  const market = await getMarketData();
  return <SettingsClient brokers={brokers} market={market} />;
}
