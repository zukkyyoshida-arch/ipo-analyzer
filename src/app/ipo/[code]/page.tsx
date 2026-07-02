import { notFound } from "next/navigation";
import { getAllIpos, getIpoByCode, getDefaultBrokers } from "@/lib/repository";
import { IpoDetailClient } from "@/components/IpoDetailClient";

export function generateStaticParams() {
  return getAllIpos().map((ipo) => ({ code: ipo.code }));
}

export default async function IpoDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const ipo = getIpoByCode(code);
  if (!ipo) notFound();

  const brokers = getDefaultBrokers();
  // 類似IPO（重複と自身を除外）。
  const similarIpos = Array.from(new Set(ipo.similarIpoCodes))
    .filter((c) => c !== ipo.code)
    .map((c) => getIpoByCode(c))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  return (
    <IpoDetailClient ipo={ipo} brokers={brokers} similarIpos={similarIpos} />
  );
}
