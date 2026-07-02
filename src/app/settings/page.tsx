import { getDefaultBrokers } from "@/lib/repository";
import { SettingsClient } from "@/components/SettingsClient";

export default function SettingsPage() {
  const brokers = getDefaultBrokers();
  return <SettingsClient brokers={brokers} />;
}
