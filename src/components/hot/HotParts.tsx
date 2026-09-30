import { Chip } from "@/components/ui/Chip";
import type { HotItem } from "@/lib/hot/score";
import { isOverheated } from "@/lib/hot/file";
import { formatSignedPct } from "@/lib/secondary/profiles";

// 注目度ランキング（ホームの「注目度」タブ）の小さな部品。

/** 注目度（0〜100）の細い横棒。 */
export function ScoreBar({ score, className = "" }: { score: number; className?: string }) {
  const width = Math.min(100, Math.max(0, score));
  return (
    <span
      aria-hidden
      className={`block h-1 overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      <span className="block h-full rounded-full bg-chart-line" style={{ width: `${width}%` }} />
    </span>
  );
}

/** 騰落率（比率）を「+12.3%」で、上昇は text-up・下落は text-down。 */
export function SignedRatio({ ratio, className = "" }: { ratio: number; className?: string }) {
  const tone = ratio > 0 ? "text-up" : ratio < 0 ? "text-down" : "text-muted";
  return <span className={`tabular-nums ${tone} ${className}`}>{formatSignedPct(ratio * 100)}</span>;
}

/** 理由チップ＋過熱の注意（初値倍率が設定した注意ラインを超えた銘柄だけ）。 */
export function HotChips({
  item,
  overheatRatio,
  className = "",
}: {
  item: HotItem;
  overheatRatio: number;
  className?: string;
}) {
  const overheated = isOverheated(item.initialRatio, overheatRatio);
  if (item.reasons.length === 0 && !overheated) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {item.reasons.map((r) => (
        <Chip key={r}>{r}</Chip>
      ))}
      {overheated && item.initialRatio !== null ? (
        <Chip tone="warn">
          初値 ×{item.initialRatio.toFixed(1)}・過熱注意
        </Chip>
      ) : null}
    </span>
  );
}
