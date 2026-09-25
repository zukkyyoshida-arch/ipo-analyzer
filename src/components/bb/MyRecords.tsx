import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { BbState } from "@/types/userData";
import { summarizeMyRecords, WEAK_SAMPLE_THRESHOLD } from "@/lib/bb/records";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { KpiTile } from "@/components/ui/KpiTile";
import { ListRow } from "@/components/ui/ListRow";

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function formatSignedYen(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toLocaleString()}円`;
}

/**
 * 「あなたの実績」。申込記録のある全銘柄を対象に、口座別の申込数・当選数・当選率と
 * 初値売り想定損益（機械的な試算）を示す。申込記録が0件ならセクションごと非表示。
 * @param ipos 全銘柄（公開価格・初値の参照用）
 * @param brokers 証券会社マスタ
 * @param bbState 申込記録
 */
export function MyRecords({
  ipos,
  brokers,
  bbState,
}: {
  ipos: Ipo[];
  brokers: Broker[];
  bbState: BbState;
}) {
  const summary = summarizeMyRecords(ipos, brokers, bbState);
  if (summary.totals.applied === 0) return null;
  const { totals, perBroker, estimatedPnl } = summary;
  const pnl = estimatedPnl.amount;

  return (
    <Section title="あなたの実績" note={`記録からの機械的集計・${summary.sampleNote}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <KpiTile
            label="当選率（合計）"
            value={formatRate(totals.winRate)}
            sub={`当選${totals.won}件／結果判明${totals.decided}件`}
          />
          <KpiTile
            label="初値売り想定損益"
            value={pnl === null ? "—" : formatSignedYen(pnl)}
            sub={`対象${estimatedPnl.count}件`}
            tone={pnl === null || pnl === 0 ? "neutral" : pnl > 0 ? "up" : "down"}
          />
        </div>

        <Card className="px-4 py-1">
          {perBroker.map((p) => (
            <ListRow
              key={p.broker.id}
              className="min-h-11"
              label={p.broker.name}
              value={
                <span className="flex flex-wrap items-center justify-end gap-x-1.5 text-xs">
                  <span className="text-muted tabular-nums">
                    申込{p.applied}・当選{p.won}
                  </span>
                  <span className="tabular-nums">{formatRate(p.winRate)}</span>
                  {p.decided < WEAK_SAMPLE_THRESHOLD ? (
                    <span className="text-[11px] text-warn">目安として弱い</span>
                  ) : null}
                </span>
              }
            />
          ))}
        </Card>

        <p className="text-[11px] leading-relaxed text-muted">
          当選率＝当選（辞退・購入済を含む）÷結果判明分（当選・補欠・落選）。母数が
          {WEAK_SAMPLE_THRESHOLD}件未満の口座は目安として弱い参考情報です。
          初値売り想定損益は当選・購入済の記録について（初値−公開価格）×100株を合算した、
          初値で売った場合の機械的な試算・手数料税金は未考慮。
          {estimatedPnl.excludedCount > 0
            ? `公開価格または初値が未取得の${estimatedPnl.excludedCount}件は除外しています。`
            : ""}
        </p>
      </div>
    </Section>
  );
}
