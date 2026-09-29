import { getAllIpos } from "@/lib/repository";
import { jstTodayIso } from "@/lib/date";
import { EventsClient } from "@/components/events/EventsClient";
import { Disclaimer } from "@/components/Disclaimer";

// 「今日」基準で今後90日・直近30日を集計するため、ホームと同じく動的レンダリングにする
// （Workers の Static Assets キャッシュ構成では時間指定の再検証が効かないため）。
// 「今日」は日本時間（JST）の日付。Workers は UTC で動くため UTC 日付だと朝9時前に前日扱いになる。
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const ipos = await getAllIpos();
  const todayIso = jstTodayIso();

  return (
    <>
      <EventsClient ipos={ipos} todayIso={todayIso} />
      <Disclaimer />
    </>
  );
}
