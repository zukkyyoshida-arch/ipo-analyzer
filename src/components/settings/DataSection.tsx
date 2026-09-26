import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { ListRow } from "@/components/ui/ListRow";
import type { MarketData, TrendDirection } from "@/types/data";

const TREND_LABEL: Record<TrendDirection, string> = {
  up: "上向き",
  flat: "横ばい",
  down: "下向き",
};

/** データ更新状況セクション。market.json の updatedAt と地合い指標の値を表示する。 */
export function DataSection({ market }: { market: MarketData }) {
  const updatedAt = formatDateTime(market.updatedAt);
  const { indicators } = market;

  return (
    <Section title="データ">
      <Card className="p-4">
        <ListRow label="データ更新" value={updatedAt} />
        <ListRow
          label="日経平均トレンド"
          value={TREND_LABEL[indicators.nikkeiTrend]}
        />
        <ListRow
          label="グロース250トレンド"
          value={TREND_LABEL[indicators.growth250Trend]}
        />
        <ListRow
          label="直近上場の初値騰落率平均"
          value={
            indicators.recentIpoAvgReturn === null
              ? "—"
              : `${indicators.recentIpoAvgReturn.toFixed(1)}%`
          }
        />
      </Card>
    </Section>
  );
}

/** ISO日時を「YYYY/MM/DD HH:mm」に整形する。不正な値はそのまま返す。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}
