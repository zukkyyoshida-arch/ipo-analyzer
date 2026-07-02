import { getAllIpos, getDefaultBrokers } from "@/lib/repository";
import { BbManagerClient } from "@/components/BbManagerClient";

export default function BbPage() {
  const ipos = getAllIpos();
  const brokers = getDefaultBrokers();
  return <BbManagerClient ipos={ipos} brokers={brokers} />;
}
