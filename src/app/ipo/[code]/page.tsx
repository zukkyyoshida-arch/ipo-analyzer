import { notFound } from "next/navigation";
import {
  getAllIpos,
  getIpoByCode,
  getDefaultBrokers,
  getMarketData,
} from "@/lib/repository";
import { IpoDetailClient } from "@/components/IpoDetailClient";

// 新規発見銘柄（ビルド時に未知）でも再ビルドなしで表示できるよう動的パラメータを許可。
export const dynamicParams = true;

export async function generateStaticParams() {
  const ipos = await getAllIpos();
  return ipos.map((ipo) => ({ code: ipo.code }));
}

export default async function IpoDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [ipo, brokers, market, allIpos] = await Promise.all([
    getIpoByCode(code),
    Promise.resolve(getDefaultBrokers()),
    getMarketData(),
    getAllIpos(),
  ]);
  if (!ipo) notFound();

  // 類似IPO（重複と自身を除外）。
  const byCode = new Map(allIpos.map((i) => [i.code, i]));
  const similarIpos = Array.from(new Set(ipo.similarIpoCodes))
    .filter((c) => c !== ipo.code)
    .map((c) => byCode.get(c))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  return (
    <IpoDetailClient
      ipo={ipo}
      brokers={brokers}
      similarIpos={similarIpos}
      market={market}
    />
  );
}
