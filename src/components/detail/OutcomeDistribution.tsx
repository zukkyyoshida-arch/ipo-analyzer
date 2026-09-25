import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { PriceChange } from "@/components/ui/PriceChange";
import {
  ABSORPTION_BAND_LABELS,
  classifyAbsorptionBand,
  type OutcomeDistributionResult,
} from "@/lib/stats";

/** 直近サンプルの表示件数。 */
const MAX_VISIBLE_SAMPLES = 5;
/** 母数がこれ未満なら「目安として弱い」と明示する。 */
const WEAK_SAMPLE_THRESHOLD = 5;

/**
 * 類似条件（吸収金額帯×市場）の初値実績分布。上場済み銘柄の機械的集計（参考情報）。
 * 母数0は数値を出さず空状態のみ。母数1〜4は「目安として弱い」を必ず添える。
 * 集計はサーバー側（page.tsx）で済ませ、結果だけを受け取る（全銘柄をクライアントへ渡さない）。
 */
export function OutcomeDistribution({
  ipo,
  result,
}: {
  ipo: Ipo;
  result: OutcomeDistributionResult;
}) {
  const bandLabel =
    ipo.absorptionAmount > 0
      ? ABSORPTION_BAND_LABELS[classifyAbsorptionBand(ipo.absorptionAmount)]
      : "未取得";
  const conditionText = `吸収金額 ${bandLabel}・${ipo.market} で上場した銘柄`;

  if (result.sampleCount === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">{conditionText}</p>
        <EmptyState title="同条件の実績データがまだありません（参考情報）" />
      </div>
    );
  }

  const n = result.sampleCount;
  const sampleNote =
    n < WEAK_SAMPLE_THRESHOLD
      ? `参考情報（母数${n}件、目安として弱い）`
      : `参考情報（母数${n}件）`;

  return (
    <Card className="p-4">
      <p
        className={`text-xs font-semibold ${n < WEAK_SAMPLE_THRESHOLD ? "text-warn" : "text-muted"}`}
      >
        {sampleNote}
      </p>
      <p className="mt-1 text-xs text-muted">{conditionText}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="公開価格超え率">
          {result.winRate === null ? "—" : `${result.winRate.toFixed(0)}%`}
        </Stat>
        <Stat label="騰落率中央値">
          <PriceChange value={result.medianReturnRate} />
        </Stat>
        <Stat label="母数">{`${n}件`}</Stat>
      </div>

      <div className="mt-3 border-t border-border pt-1">
        {result.samples.slice(0, MAX_VISIBLE_SAMPLES).map((s) => (
          <ListRow
            key={s.code}
            className="min-h-11"
            label={`${s.code}・${s.name}`}
            value={<PriceChange value={s.returnRate} />}
          />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        上場済み銘柄の実績を機械的に集計した値です。将来の値動きを示すものではありません。
      </p>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-text tabular-nums">
        {children}
      </p>
    </div>
  );
}
