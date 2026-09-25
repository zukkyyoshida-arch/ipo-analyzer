import type { HomeKpis } from "@/lib/home";
import { KpiTile } from "@/components/ui/KpiTile";
import { formatDate } from "@/lib/format";

/**
 * ホームKPI4枚。対象銘柄数／直近90日の初値騰落率平均／直近90日の公募割れ率／
 * 直近90日のトップパフォーマー。データが無い項目は「—」。
 */
export function KpiGrid({ kpis }: { kpis: HomeKpis }) {
  const avg = kpis.avgInitialReturnRate;
  const breakEven = kpis.breakEvenRate;
  const top = kpis.topPerformer;

  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiTile label="対象銘柄数" value={`${kpis.totalCount}件`} tone="neutral" />
      <KpiTile
        label="直近90日 初値騰落率平均"
        value={avg === null ? "—" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`}
        tone={avg === null ? "neutral" : avg >= 0 ? "up" : "down"}
        sub={`上場${kpis.recentListedCount}件が対象`}
      />
      <KpiTile
        label="直近90日 公募割れ率"
        value={breakEven === null ? "—" : `${breakEven.toFixed(0)}%`}
        tone={breakEven === null ? "neutral" : breakEven >= 50 ? "down" : "neutral"}
      />
      <KpiTile
        label="直近90日 トップパフォーマー"
        value={top === null ? "—" : top.ipo.name}
        tone={top === null ? "neutral" : "accent"}
        sub={
          top === null
            ? undefined
            : `${top.returnRate >= 0 ? "+" : ""}${top.returnRate.toFixed(1)}% (${
                top.metric === "initialReturnRate" ? "初値比" : "現在値/初値比"
              }) · ${formatDate(top.ipo.listingDate)}`
        }
      />
    </div>
  );
}
