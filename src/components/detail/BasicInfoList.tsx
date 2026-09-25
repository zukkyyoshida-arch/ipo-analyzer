import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { Chip } from "@/components/ui/Chip";
import { formatOku } from "@/lib/format";

/** 0や空文字などの既定値（未取得）は「—」を返す。 */
function orDash(value: number, formatted: string): string {
  return value === 0 ? "—" : formatted;
}

/**
 * 基本情報の縦積みリスト（ListRow）。
 * 吸収金額・時価総額・公募/売出/OA株数・オファリングレシオ・VC比率・
 * ロックアップ・主幹事・引受幹事・PER/PSR・売上/成長率/営業利益・テーマ。
 */
export function BasicInfoList({ ipo }: { ipo: Ipo }) {
  return (
    <Card className="p-4">
      <ListRow
        label="吸収金額(OA込)"
        value={orDash(ipo.absorptionAmount, formatOku(ipo.absorptionAmount))}
      />
      <ListRow
        label="想定時価総額"
        value={orDash(ipo.marketCap, formatOku(ipo.marketCap))}
      />
      <ListRow
        label="公募株数"
        value={
          ipo.publicShares === 0
            ? "—"
            : `${ipo.publicShares.toLocaleString()}株`
        }
      />
      <ListRow
        label="売出株数"
        value={
          ipo.saleShares === 0 ? "—" : `${ipo.saleShares.toLocaleString()}株`
        }
      />
      <ListRow
        label="OA株数"
        value={
          ipo.overAllotment === 0
            ? "—"
            : `${ipo.overAllotment.toLocaleString()}株`
        }
      />
      <ListRow
        label="オファリングレシオ"
        value={ipo.offeringRatio === 0 ? "—" : `${ipo.offeringRatio}%`}
      />
      <ListRow label="VC比率" value={ipo.vcRatio === 0 ? "—" : `${ipo.vcRatio}%`} />
      <ListRow
        label="ロックアップ"
        value={
          ipo.lockup.days === 0
            ? "—"
            : `${ipo.lockup.days}日${ipo.lockup.hasPriceRelease ? "・1.5倍解除あり" : ""}`
        }
      />
      <ListRow
        label="主幹事"
        value={ipo.leadUnderwriter === "" ? "—" : ipo.leadUnderwriter}
      />
      <ListRow
        label="引受幹事"
        value={ipo.underwriters.length === 0 ? "—" : ipo.underwriters.join("・")}
      />
      <ListRow
        label="PER"
        value={ipo.per === null ? "—" : `${ipo.per}倍`}
      />
      <ListRow
        label="PSR"
        value={ipo.psr === null ? "—" : `${ipo.psr}倍`}
      />
      <ListRow
        label="売上高"
        value={
          ipo.financials.revenue === 0
            ? "—"
            : `${ipo.financials.revenue.toLocaleString()}百万円`
        }
      />
      <ListRow
        label="売上成長率"
        value={
          ipo.financials.revenueGrowth === 0
            ? "—"
            : `${ipo.financials.revenueGrowth}%`
        }
      />
      <ListRow
        label="営業利益"
        value={
          ipo.financials.operatingProfit === 0
            ? "—"
            : `${ipo.financials.operatingProfit.toLocaleString()}百万円（${
                ipo.financials.isProfitable ? "黒字" : "赤字"
              }）`
        }
      />
      <div className="flex items-center justify-between gap-3 py-2.5">
        <span className="text-sm text-muted">テーマ</span>
        <div className="flex flex-wrap justify-end gap-1">
          {ipo.theme.length === 0 ? (
            <span className="text-sm font-medium text-text">—</span>
          ) : (
            ipo.theme.map((t) => (
              <Chip key={t} tone="neutral">
                {t}
              </Chip>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
