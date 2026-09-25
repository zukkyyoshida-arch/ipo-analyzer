import { getAllIpos } from "@/lib/repository";
import { EventsClient } from "@/components/events/EventsClient";
import { Disclaimer } from "@/components/Disclaimer";

// 「今日」基準で今後90日・直近30日を集計するため、ホームと同じく動的レンダリングにする
// （Workers の Static Assets キャッシュ構成では時間指定の再検証が効かないため）。
export const dynamic = "force-dynamic";

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function EventsPage() {
  const ipos = await getAllIpos();
  const todayIso = todayIsoUtc();

  return (
    <>
      <EventsClient ipos={ipos} todayIso={todayIso} />
      <Disclaimer />
    </>
  );
}
