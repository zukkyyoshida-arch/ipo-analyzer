import type { ReactNode } from "react";
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
import { PICK_VERDICT_THRESHOLDS, pickVerdict, pickVerdictSummary } from "@/lib/picks/verdict";
import { PickCard } from "./PickCard";

// 指標の帯の列幅。BB期間（「10/15〜10/21」）がいちばん長いので広めに取る。
const METRIC_GRID =
  "grid-cols-[minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.85fr)]";

const T = PICK_VERDICT_THRESHOLDS;
const pct = (v: number) => `${Math.round(v * 100)}%`;

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
 * 1 銘柄 1 カードで、結論（参加候補・様子見・見送り。lib/picks/verdict.ts）と根拠の1行だけを見せ、
 * チップ・指標の表は「根拠と指標」に畳む。
 * @param picks rankBbPicks の結果（スコアの高い順）
 */
export function BbPicksPanel({ picks }: { picks: BbPick[] }) {
  const openCount = picks.filter((p) => p.phase === "open").length;
  const beforeCount = picks.length - openCount;

  return (
    <div>
      <section>
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
            <ol className="mt-3 space-y-3">
              {picks.map((pick, i) => (
                <BbPickRow key={pick.ipo.code} rank={i + 1} pick={pick} />
              ))}
            </ol>
            <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-subtle">
              <p>
                結論は、BB スコア {T.goMinBbScore} 以上・公募割れ {pct(T.goMaxBreakEven)} 未満・✗ {T.goMaxFail} 個以下なら「参加候補」、
                公募割れ {pct(T.skipMinBreakEven)} 以上か ✗ {T.skipMinFail} 個以上なら「見送り」、それ以外は「様子見」です。
              </p>
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
  const verdictInput = {
    bbScore: pick.bbScore,
    breakEvenProbability: pick.breakEvenProbability,
    failCount: pick.checkCounts ? pick.checkCounts.fail : null,
  };
  const metrics: { label: string; value: ReactNode }[] = [
    { label: "BB期間", value: bbPeriodText(ipo.bbPeriod.start, ipo.bbPeriod.end) },
    { label: "上場日", value: ipo.listingDate ? formatMonthDay(ipo.listingDate) : "未定" },
    { label: "吸収金額", value: ipo.absorptionAmount > 0 ? formatOku(ipo.absorptionAmount) : "—" },
    { label: "公募割れ", value: <BreakEvenValue probability={pick.breakEvenProbability} /> },
  ];

  return (
    <PickCard
      href={`/ipo/${ipo.code}`}
      code={ipo.code}
      name={ipo.name}
      rank={rank}
      status={<PhaseLabel phase={pick.phase} start={ipo.bbPeriod.start} end={ipo.bbPeriod.end} />}
      verdict={pickVerdict(verdictInput)}
      summary={pickVerdictSummary(verdictInput)}
      details={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
            {ipo.leadUnderwriter ? <span>主幹事 {ipo.leadUnderwriter}</span> : null}
            {pick.checkCounts ? (
              <span className="inline-flex items-center gap-1">
                チェック
                <CheckCountsInline counts={pick.checkCounts} />
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              BB スコア <span className="tabular-nums text-text">{pick.bbScore}</span>
              <ScoreBar score={pick.bbScore} className="w-12" />
            </span>
          </div>
          {pick.reasons.length > 0 || pick.instantCash ? (
            <div className="flex flex-wrap gap-1">
              {pick.reasons.map((r) => (
                <Chip key={r.key} tone={r.tone === "good" ? "up" : "down"}>
                  {r.text}
                </Chip>
              ))}
              <InstantCashChip status={pick.instantCash} />
            </div>
          ) : null}
          <div className={`grid ${METRIC_GRID} gap-1 rounded-lg bg-surface-2 px-2 py-1.5`}>
            {metrics.map((m) => (
              <span key={m.label} className="flex min-w-0 flex-col">
                <span className="text-[11px] text-muted">{m.label}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
              </span>
            ))}
          </div>
        </div>
      }
    />
  );
}
