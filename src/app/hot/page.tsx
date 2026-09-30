import { getHotData } from "@/lib/repository";
import { HotRankingClient } from "@/components/hot/HotRankingClient";
import { Disclaimer } from "@/components/Disclaimer";

// いま熱い銘柄（全ランキング）。夜間のデータ更新で作る hot.json を読むだけのページで、
// ビルド時に静的生成する（表示のたびに株価を取りにいかない）。
export default async function HotPage() {
  const hot = await getHotData();
  return (
    <>
      <HotRankingClient hot={hot} />
      <Disclaimer />
    </>
  );
}
