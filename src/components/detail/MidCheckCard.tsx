import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import type { CheckpointEnriched } from "@/lib/checkpoints/types";
import type { CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import type { MidItem } from "@/lib/midterm/file";
import type { FinsItem } from "@/types/fins";
import type { MarginItem } from "@/types/margin";
import { formatMonthDay } from "@/lib/hot/file";
import { midPassCount, monthDayJa, runMidChecks, type MidManualVerdict } from "@/lib/picks/midSecondary";
import { MidChecklist } from "@/components/picks/MidChecklist";

// 銘柄詳細の「中長期チェック（10 項目）」カード。中長期セカンダリの母集団（midterm.json）に入っている銘柄だけに出す。
// 見た目は CheckpointCard に合わせる。判定は lib/picks/midSecondary.ts（runMidChecks）で、ここは表示だけ。

/** ページ（サーバー）が用意する材料。財務・信用残は古ければ null。 */
export interface MidDetailInput {
  item: MidItem;
  fins: FinsItem | null;
  margin: MarginItem | null;
  /** 財務（J-Quants）の基準日（古い・無いなら null） */
  finsAsOf: string | null;
  /** 信用残（JPX）の基準日（古い・無いなら null） */
  marginAsOf: string | null;
}

/**
 * @param ipo 対象銘柄
 * @param enriched 補完データ（業績・大株主・発行済株数）
 * @param input 中長期の材料
 * @param thresholds 設定のしきい値
 * @param todayIso 日本時間の今日
 * @param manual ①業種業態の目視
 * @param onManual 目視を変える
 */
export function MidCheckCard({
  ipo,
  enriched,
  input,
  thresholds,
  todayIso,
  manual,
  onManual,
}: {
  ipo: Ipo;
  enriched?: CheckpointEnriched;
  input: MidDetailInput;
  thresholds: CheckpointThresholds;
  todayIso: string;
  manual?: MidManualVerdict;
  onManual?: (code: string, verdict: MidManualVerdict | null) => void;
}) {
  const checks = runMidChecks({
    item: input.item,
    ipo,
    enriched,
    todayIso,
    fins: input.fins ?? undefined,
    margin: input.margin ?? undefined,
    manual,
    thresholds,
  });
  const { passCount, checkTotal } = midPassCount(checks);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">中長期チェック（10 項目）</h2>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium tabular-nums text-text">
          クリア {passCount}/{checkTotal}
        </span>
      </div>
      <MidChecklist code={ipo.code} checks={checks} manual={manual} onManual={onManual} />
      <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted">
        <p>
          株価 {formatMonthDay(input.item.lastDate)} 終値時点。
          {input.finsAsOf ? `財務 ${monthDayJa(input.finsAsOf)}時点（J-Quants・約12週遅延）。` : "財務はデータ待ち。"}
          {input.marginAsOf ? `信用残 ${monthDayJa(input.marginAsOf)}時点（JPX）。` : "信用残はデータ待ち。"}
        </p>
        <p>業績・財務・信用残・進捗は過去検証で効果なし。講師基準の参考表示です。</p>
        <p>
          基準は
          <Link href="/settings#thresholds" className="mx-0.5 text-accent underline-offset-2 hover:underline">
            設定の「手法のしきい値」
          </Link>
          で変えられます。①の ◎○× はこの端末に保存されます。
        </p>
      </div>
    </section>
  );
}
