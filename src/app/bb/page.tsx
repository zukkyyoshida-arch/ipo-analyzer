import {
  getAllEnriched,
  getAllIpos,
  getDefaultBrokers,
  getMarketData,
} from "@/lib/repository";
import { BbManagerClient } from "@/components/BbManagerClient";
import { jstTodayIso } from "@/lib/date";
import { Disclaimer } from "@/components/Disclaimer";

export default async function BbPage() {
  const [ipos, enriched, market] = await Promise.all([
    getAllIpos(),
    getAllEnriched(),
    getMarketData(),
  ]);
  const brokers = getDefaultBrokers();
  // enriched 全体（業績・株主等）は大きいため、BB画面で使う幹事配分だけに絞って渡す。
  const allocations = enriched
    .filter((e) => e.underwriterAllocations && e.underwriterAllocations.length > 0)
    .map((e) => ({ code: e.code, underwriterAllocations: e.underwriterAllocations }));
  return (
    <>
      <BbManagerClient
        ipos={ipos}
        brokers={brokers}
        enriched={allocations}
        autoSentiment={market.sentiment}
        // 銘柄の区分分け（BB中・これから等）の初回描画用。マウント後はクライアントで日本時間の今日へ更新する。
        initialTodayIso={jstTodayIso()}
      />
      <Disclaimer />
    </>
  );
}
