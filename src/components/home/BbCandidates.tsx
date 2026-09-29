import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import { ScorePill } from "@/components/ScoreBadge";
import { WatchStar } from "@/components/WatchStar";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ScoreSettings } from "@/lib/scoring";
import { buildBbContext, scoreBbParticipation } from "@/lib/scoring/bb";
import { underwriterBreakEvenStat } from "@/lib/stats";
import { topBbCandidates, type BbHighlightItem } from "@/lib/home";
import { STATUS_LABELS, formatDate, formatOku } from "@/lib/format";

/**
 * 全銘柄の BB参加スコアを計算し、topBbCandidates で上位 n 件を選ぶヘルパ（HomeClient の useMemo から呼ぶ想定）。
 * 主幹事別公募割れ率は全銘柄（上場済の実績）から主幹事ごとに1回だけ集計して使い回す。
 */
export function computeBbCandidates(
  ipos: Ipo[],
  settings: ScoreSettings,
  n = 3,
): BbHighlightItem[] {
  const statCache = new Map<string, ReturnType<typeof underwriterBreakEvenStat>>();
  const statFor = (underwriter: string) => {
    const key = underwriter.trim();
    if (!statCache.has(key)) {
      statCache.set(key, underwriterBreakEvenStat(ipos, key));
    }
    return statCache.get(key) ?? null;
  };

  const scored: BbHighlightItem[] = ipos
    .filter((ipo) => ipo.status !== "listed")
    .map((ipo) => ({
      ipo,
      bbScore: scoreBbParticipation(
        ipo,
        settings,
        statFor(ipo.leadUnderwriter),
        undefined,
        buildBbContext(ipo, ipos),
      ).score,
    }));

  return topBbCandidates(scored, n);
}

/** BB期間の表示文言。未取得なら「未取得」。 */
function bbPeriodText(ipo: Ipo): string {
  const { start, end } = ipo.bbPeriod;
  if (!start && !end) return "未取得";
  const fmt = (iso: string) => (iso ? formatDate(iso).slice(5) : "—");
  return `${fmt(start)}〜${fmt(end)}`;
}

/**
 * BB参加候補（BB参加スコア上位）。topBbCandidates で選定済みの items を受け取る。
 * IpoCard は需給/ファンダ表示のため、BB参加スコアを見せる軽量カードを既存部品で組む。
 */
export function BbCandidates({
  items,
  watched,
  onToggleWatch,
}: {
  items: BbHighlightItem[];
  watched: (code: string) => boolean;
  onToggleWatch: (code: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState title="現在BB受付中・受付前で条件一致の銘柄はありません" />
    );
  }

  return (
    <div className="space-y-3">
      {items.map(({ ipo, bbScore }) => (
        <Link
          key={ipo.code}
          href={`/ipo/${ipo.code}`}
          // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
          prefetch={false}
          className="block rounded-2xl border border-border bg-surface p-4 active:opacity-80"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Chip tone="accent">{STATUS_LABELS[ipo.status]}</Chip>
                <span className="text-xs text-muted">{ipo.code}</span>
                <span className="text-xs text-muted">{ipo.market}</span>
              </div>
              <h3 className="mt-1 truncate text-base font-bold text-text">
                {ipo.name}
              </h3>
            </div>
            <WatchStar
              active={watched(ipo.code)}
              onToggle={() => onToggleWatch(ipo.code)}
            />
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted">BB期間</dt>
              <dd className="font-medium tabular-nums text-text">
                {bbPeriodText(ipo)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">上場日</dt>
              <dd className="font-medium tabular-nums text-text">
                {ipo.listingDate ? formatDate(ipo.listingDate) : "未定"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">吸収金額</dt>
              <dd className="font-medium tabular-nums text-text">
                {ipo.absorptionAmount > 0
                  ? formatOku(ipo.absorptionAmount)
                  : "未取得"}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 tabular-nums">
            <ScorePill score={bbScore} label="BB参加" />
          </div>
        </Link>
      ))}
    </div>
  );
}
