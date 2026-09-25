import { notFound } from "next/navigation";
import {
  getAllIpos,
  getIpoByCode,
  getDefaultBrokers,
  getMarketData,
  getEnrichedByCode,
} from "@/lib/repository";
import { IpoDetailClient } from "@/components/IpoDetailClient";
import { Disclaimer } from "@/components/Disclaimer";
import {
  outcomeDistributionByAbsorptionBand,
  underwriterBreakEvenStat,
} from "@/lib/stats";
import { jstTodayIso } from "@/lib/date";

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
  const [ipo, brokers, market, allIpos, enriched] = await Promise.all([
    getIpoByCode(code),
    Promise.resolve(getDefaultBrokers()),
    getMarketData(),
    getAllIpos(),
    getEnrichedByCode(code),
  ]);
  if (!ipo) notFound();

  // 類似IPO（重複と自身を除外）。
  const byCode = new Map(allIpos.map((i) => [i.code, i]));
  const similarIpos = Array.from(new Set(ipo.similarIpoCodes))
    .filter((c) => c !== ipo.code)
    .map((c) => byCode.get(c))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  // 統計はサーバー側で集計し、結果だけをクライアントへ渡す（全銘柄を埋め込まない）。
  // 主幹事実績は自身を除く（上場済み銘柄の結果リーク回避）。
  const underwriterStat = underwriterBreakEvenStat(
    allIpos.filter((i) => i.code !== ipo.code),
    ipo.leadUnderwriter,
  );
  const outcome = outcomeDistributionByAbsorptionBand(allIpos, ipo);

  return (
    <div>
      <IpoDetailClient
        ipo={ipo}
        brokers={brokers}
        similarIpos={similarIpos}
        market={market}
        underwriterStat={underwriterStat}
        outcome={outcome}
        enriched={enriched}
        todayIso={jstTodayIso()}
      />
      <Disclaimer />
    </div>
  );
}
