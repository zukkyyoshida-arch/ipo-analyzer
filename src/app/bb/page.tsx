import { getAllIpos, getDefaultBrokers } from "@/lib/repository";
import { BbManagerClient } from "@/components/BbManagerClient";
import { Disclaimer } from "@/components/Disclaimer";

export default async function BbPage() {
  const ipos = await getAllIpos();
  const brokers = getDefaultBrokers();
  return (
    <>
      <BbManagerClient ipos={ipos} brokers={brokers} />
      <Disclaimer />
    </>
  );
}
