import type { ReactNode } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { DetailButton } from "@/components/analytics/DetailButton";
import { ScoreBar } from "@/components/hot/HotParts";
import { formatMonthDay } from "@/lib/hot/file";
import { formatOku } from "@/lib/format";
import { BB_SCORE_ITEM_LABELS, DEFAULT_BB_WEIGHTS, RECENT_IPO_COUNT, type BbScoreItemKey } from "@/lib/scoring/bb";
import type { BbPick, BbPickPhase } from "@/lib/picks/bb";
import model from "@/lib/scoring/bb-model.json";
import { CheckCountsInline, InstantCashChip } from "@/components/checkpoints/CheckpointParts";

// 行の格子。スマホは「順位・コード・銘柄・スコア」の下に指標の帯、1280px では指標を列に並べる
// （ホームの注目度ランキングと同じ組み方）。
const ROW_GRID =
  "grid grid-cols-[1rem_2.5rem_minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[1rem_2.5rem_minmax(0,1fr)_24rem_4.5rem]";

const METRIC_LABELS = ["BB期間", "上場日", "吸収金額", "公募割れ"] as const;

// 指標の帯の列幅。BB期間（「10/15〜10/21」）がいちばん長いので広めに取る。
const METRIC_GRID =
  "grid-cols-[minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.85fr)]";

/** BB スコアの見方に並べる順（重みの大きい順）と短い説明。 */
const WEIGHT_ROWS: { key: BbScoreItemKey; note: string }[] = [
  { key: "absorption", note: "小さいほど需給が締まりやすい" },
  { key: "offeringRatioBb", note: "上場時に市場へ出る株の比率。低いほど良い" },
  { key: "priceRangePosition", note: "仮条件が想定価格より上なら需要が強い" },
  { key: "underwriterTrack", note: "同じ主幹事の直近3年の公募割れ率" },
  { key: "vcLockup", note: "VC の持ち株比率とロックアップの強さ" },
  { key: "saleRatio", note: "売出 ÷（公募＋売出）。高いほど緩みやすい" },
  { key: "recentIpoSentiment", note: `直前に上場した${RECENT_IPO_COUNT}銘柄の初値騰落率の平均` },
  { key: "sentiment", note: "設定の地合い（全銘柄に同じ点）" },
];

/** 受付状況の表示（受付中は緑の点）。 */
function PhaseLabel({ phase, start, end }: { phase: BbPickPhase; start: string; end: string }) {
  if (phase === "open") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-live" />
        受付中{end ? <span className="tabular-nums text-subtle">{formatMonthDay(end)}まで</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      受付前{start ? <span className="tabular-nums text-subtle">{formatMonthDay(start)}から</span> : null}
    </span>
  );
}

/** 公募割れ確率（0〜1）の表示。30%以上は赤、10%未満は緑（銘柄詳細のカードと同じ境目）。 */
function BreakEvenValue({ probability }: { probability: number | null }) {
  if (probability === null) return <span className="text-subtle">—</span>;
  const percent = Math.round(probability * 100);
  const tone = percent >= 30 ? "text-ng" : percent < 10 ? "text-ok" : "text-text";
  return <span className={`tabular-nums ${tone}`}>{percent}%</span>;
}

function bbPeriodText(start: string, end: string): string {
  if (!start && !end) return "—";
  return `${start ? formatMonthDay(start) : "—"}〜${end ? formatMonthDay(end) : "—"}`;
}

/**
 * ホームの「ピックアップ」→「BB」。受付中・受付前の銘柄を BB 参加スコアの高い順に並べる。
 * 選定と並べ替えは lib/picks/bb.ts（rankBbPicks）で済ませ、ここは表示だけ。
 * @param picks rankBbPicks の結果（スコアの高い順）
 */
export function BbPicksPanel({ picks }: { picks: BbPick[] }) {
  const openCount = picks.filter((p) => p.phase === "open").length;
  const beforeCount = picks.length - openCount;

  return (
    <div>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-medium text-text">BB スコア順</h2>
          {picks.length > 0 ? (
            <span className="text-xs tabular-nums text-subtle">
              受付中 {openCount}・受付前 {beforeCount}
            </span>
          ) : null}
        </div>

        {picks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            いま BB を受け付けている銘柄・これから受け付ける銘柄はありません
          </p>
        ) : (
          <>
            <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
              <span className="col-span-3">銘柄</span>
              <span className={`hidden lg:col-start-4 lg:grid lg:gap-1 ${METRIC_GRID}`}>
                {METRIC_LABELS.map((label) => (
                  <span key={label} className="text-right">
                    {label}
                  </span>
                ))}
              </span>
              <span className="col-start-4 text-right lg:col-start-5">BB スコア</span>
            </div>
            <ol>
              {picks.map((pick, i) => (
                <BbPickRow key={pick.ipo.code} rank={i + 1} pick={pick} />
              ))}
            </ol>
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
              <p>
                公募割れは、BB スコアの各項目を{model.trainedFrom.slice(0, 4)}〜{model.trainedThrough.slice(0, 4)}年に上場した
                {model.sampleCount.toLocaleString("ja-JP")}銘柄の実績に当てはめた確率です（学習に使っていない
                {model.validation.sampleCount}銘柄で検証）。
              </p>
              <p>
                チェックは銘柄詳細の「チェックポイント」9 項目のクリア（✓）・注意（△）・警戒（✗）の数です。即金規制の可能性は、予想初値が公開価格（未定なら仮条件の上限）の
                設定の倍率（既定 2.3 倍）以上になりそうな銘柄に付けています。
              </p>
              <p>判断材料であり売買推奨ではありません。</p>
            </div>
          </>
        )}
        <DetailButton href="/bb" label="BB 管理へ" />
      </section>

      <Disclosure
        className="mt-4 rounded-xl border border-border bg-surface px-4"
        summary="BB スコアの見方"
      >
        <div className="space-y-3 pb-4 text-xs leading-relaxed text-muted">
          <p>
            BB を受け付けている銘柄と、これから受け付ける銘柄が対象です。上場前に分かる8項目をそれぞれ −2〜+2 点にし、重みを掛けて足したものを
            0〜100 に直しています。50 が中立です。
          </p>
          <ul className="divide-y divide-border rounded-lg bg-surface-2 px-3">
            {WEIGHT_ROWS.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-text">{BB_SCORE_ITEM_LABELS[row.key]}</span>
                  <span className="block text-[11px] text-subtle">{row.note}</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-text">
                  重み {DEFAULT_BB_WEIGHTS[row.key]}
                </span>
              </li>
            ))}
          </ul>
          <p>
            チップは点数への影響が大きい項目です（地合いを除く）。緑は加点、赤は減点を表します。項目ごとの点数は銘柄の詳細で見られます。
          </p>
        </div>
      </Disclosure>
    </div>
  );
}

function BbPickRow({ rank, pick }: { rank: number; pick: BbPick }) {
  const { ipo } = pick;
  const metrics: { label: (typeof METRIC_LABELS)[number]; value: ReactNode }[] = [
    { label: "BB期間", value: bbPeriodText(ipo.bbPeriod.start, ipo.bbPeriod.end) },
    { label: "上場日", value: ipo.listingDate ? formatMonthDay(ipo.listingDate) : "未定" },
    { label: "吸収金額", value: ipo.absorptionAmount > 0 ? formatOku(ipo.absorptionAmount) : "—" },
    { label: "公募割れ", value: <BreakEvenValue probability={pick.breakEvenProbability} /> },
  ];

  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/ipo/${ipo.code}`}
        // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
        prefetch={false}
        className={`${ROW_GRID} items-center py-3 active:opacity-80`}
      >
        <span className="col-start-1 row-start-1 text-center text-sm tabular-nums text-muted">{rank}</span>
        <span className="col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {ipo.code}
        </span>
        <span className="col-start-3 row-start-1 min-w-0">
          <span className="block truncate text-sm text-text">{ipo.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
            <PhaseLabel phase={pick.phase} start={ipo.bbPeriod.start} end={ipo.bbPeriod.end} />
            {ipo.leadUnderwriter ? <span className="truncate">主幹事 {ipo.leadUnderwriter}</span> : null}
            {pick.checkCounts ? (
              <span className="inline-flex items-center gap-1">
                チェック
                <CheckCountsInline counts={pick.checkCounts} />
              </span>
            ) : null}
          </span>
          {pick.reasons.length > 0 || pick.instantCash ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {pick.reasons.map((r) => (
                <Chip key={r.key} tone={r.tone === "good" ? "up" : "down"}>
                  {r.text}
                </Chip>
              ))}
              <InstantCashChip status={pick.instantCash} />
            </span>
          ) : null}
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-text">{pick.bbScore}</span>
          <ScoreBar score={pick.bbScore} className="mt-1.5 w-12" />
        </span>
        <span className={`col-span-4 col-start-1 row-start-2 mt-2 grid ${METRIC_GRID} gap-1 rounded-lg bg-surface-2 px-2 py-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:bg-transparent lg:p-0`}>
          {metrics.map((m) => (
            <span key={m.label} className="flex min-w-0 flex-col lg:items-end">
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
