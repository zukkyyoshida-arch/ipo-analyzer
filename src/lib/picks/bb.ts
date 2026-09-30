import type { Ipo } from "@/types/ipo";
import type { HistoricalIpo } from "@/types/history";
import type { ScoreSettings } from "@/lib/scoring/types";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";
import { assessCompleteness } from "@/lib/completeness";
import { combineOutcomeSources } from "@/lib/stats/history";
import {
  scoreBbParticipation,
  type BbScoreContext,
  type BbScoreItemKey,
  type BbScoreItemOutput,
  type BbScoreResult,
} from "@/lib/scoring/bb";
import { buildBbInputs } from "@/lib/scoring/bbInputs";
import { topBbCandidates } from "@/lib/home";
import type { IpoEnriched } from "@/types/enriched";
import { buildRecentPool } from "@/lib/secondary/initialForecast";
import { bbForecastRatio, instantCashStatus, type InstantCashStatus } from "@/lib/checkpoints/instantCash";
import { runCommonCheckpoints } from "@/lib/checkpoints/common";
import { DEFAULT_THRESHOLDS, type CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import type { CheckpointCounts, CheckpointEnriched } from "@/lib/checkpoints/types";

// ホームの「ピックアップ」→「BB」の選定ロジック。純関数だけを置く。
// サーバー（page.tsx）が buildBbPickInputs で対象と材料（主幹事の実績・公募割れ確率）を作り、
// クライアント（HomeClient）が rankBbPicks で設定（地合い）を反映したスコアを付けて並べる。
// 材料は銘柄詳細と同じ buildBbInputs で作るので、スコア・公募割れ確率は詳細画面と一致する。

/** BB の受付状況。open=受付中 / before=受付前。 */
export type BbPickPhase = "open" | "before";

/**
 * ピックアップの対象になる受付状況。上場済・受付が終わった銘柄・日程が分からない銘柄は null。
 * BB 期間が両端とも分かるときは日付で決め、分からないときは status（bb_open）と開始日で決める
 * （受付中の判定は analytics の isBbOpen と同じ）。
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function bbPickPhase(ipo: Ipo, todayIso: string): BbPickPhase | null {
  if (ipo.status === "listed") return null;
  const { start, end } = ipo.bbPeriod;
  if (start && end) {
    if (todayIso < start) return "before";
    if (todayIso <= end) return "open";
    return null;
  }
  if (ipo.status === "bb_open") return "open";
  if (start && todayIso < start) return "before";
  return null;
}

/**
 * ピックアップの対象（受付中・受付前で、公開価格か吸収金額の少なくとも一方が分かっている銘柄）。
 * 並びは入力順のまま。
 */
export function bbPickPool(
  ipos: Ipo[],
  todayIso: string,
): { ipo: Ipo; phase: BbPickPhase }[] {
  const pool: { ipo: Ipo; phase: BbPickPhase }[] = [];
  for (const ipo of ipos) {
    const phase = bbPickPhase(ipo, todayIso);
    if (phase === null) continue;
    if (assessCompleteness(ipo).level === "insufficient") continue;
    pool.push({ ipo, phase });
  }
  return pool;
}

/** サーバーからクライアントへ渡す、1銘柄分の材料（全銘柄・履歴は渡さない）。 */
export interface BbPickInput {
  code: string;
  phase: BbPickPhase;
  /** 主幹事の公募割れ実績（直近3年・自身を除く）。 */
  underwriterStat: UnderwriterBreakEvenStat | null;
  /** 直近 IPO の初値動向・同週上場件数。 */
  context: BbScoreContext;
  /** 公募割れ確率（0〜1、実績ベース）。未取得項目が多い銘柄は null。 */
  breakEvenProbability: number | null;
  /** 予想初値 ÷ 公開価格（公開価格が未定なら仮条件の上限で決まったとみなす）。予想できなければ null。 */
  forecastRatio?: number | null;
}

/**
 * ピックアップの対象と材料を作る（サーバーで呼ぶ）。対象が無ければ履歴の結合もしない。
 * @param ipos 現行データの全銘柄
 * @param history 2015〜2023 年の履歴（主幹事の実績の母数）
 * @param todayIso 日本時間の今日（YYYY-MM-DD）
 */
export function buildBbPickInputs(
  ipos: Ipo[],
  history: readonly HistoricalIpo[],
  todayIso: string,
  enriched: readonly IpoEnriched[] = [],
): BbPickInput[] {
  const pool = bbPickPool(ipos, todayIso);
  if (pool.length === 0) return [];
  const sources = combineOutcomeSources(ipos, history);
  const recentPool = buildRecentPool(ipos, history);
  const enrichedByCode = new Map(enriched.map((e) => [e.code, e]));
  return pool.map(({ ipo, phase }) => {
    const { underwriterStat, bbContext, breakEvenProbability } = buildBbInputs(
      ipo,
      ipos,
      sources,
      todayIso,
    );
    return {
      code: ipo.code,
      phase,
      underwriterStat,
      context: bbContext,
      breakEvenProbability: breakEvenProbability?.probability ?? null,
      forecastRatio: bbForecastRatio(ipo, recentPool, enrichedByCode.get(ipo.code)),
    };
  });
}

/** 受付中の銘柄の数（?m= が無いときの手法を決めるのに使う）。 */
export function countBbOpen(inputs: readonly Pick<BbPickInput, "phase">[]): number {
  return inputs.filter((i) => i.phase === "open").length;
}

/** 行に出す理由（点数への影響が大きい項目）。 */
export interface BbPickReason {
  key: BbScoreItemKey;
  text: string;
  /** good=加点 / bad=減点 */
  tone: "good" | "bad";
}

/** 理由の最大件数。 */
export const BB_PICK_REASON_MAX = 3;

/** 地合いは全銘柄に同じ点が付き、銘柄の違いを表さないので理由に出さない。 */
const REASON_EXCLUDED: ReadonlySet<BbScoreItemKey> = new Set(["sentiment"]);

/** 小数1桁に丸めた数（末尾の .0 は付けない）。 */
function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function reasonText(
  item: BbScoreItemOutput,
  underwriterStat: UnderwriterBreakEvenStat | null,
  context: BbScoreContext,
): string {
  switch (item.key) {
    case "absorption":
      return `吸収金額 ${item.rawText}`;
    case "offeringRatioBb":
      return `オファリングレシオ ${item.rawText}`;
    case "underwriterTrack":
      return underwriterStat
        ? `主幹事の公募割れ率 ${round1(underwriterStat.breakEvenRate)}%`
        : item.label;
    case "priceRangePosition":
      return item.points > 0 ? "仮条件が想定価格より上" : "仮条件が想定価格より下";
    case "vcLockup":
      return item.rawText;
    case "saleRatio":
      return `売出比率 ${item.rawText}`;
    case "recentIpoSentiment": {
      const avg = context.recentIpoAvgReturn;
      if (avg === null || avg === undefined) return item.label;
      return `直近IPOの初値 平均${avg >= 0 ? "+" : ""}${round1(avg)}%`;
    }
    case "sentiment":
      return `地合い ${item.rawText}`;
  }
}

/**
 * 点数への影響（重み×点）が大きい順に最大 max 件の理由を作る。0 点の項目と地合いは出さない。
 * 影響が同じなら加点を先にし、表示は加点→減点の順にまとめる。
 */
export function bbPickReasons(
  result: BbScoreResult,
  underwriterStat: UnderwriterBreakEvenStat | null,
  context: BbScoreContext,
  max: number = BB_PICK_REASON_MAX,
): BbPickReason[] {
  const picked = result.items
    .filter((i) => !REASON_EXCLUDED.has(i.key) && i.points !== 0 && i.contribution !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.contribution) - Math.abs(a.contribution) || b.contribution - a.contribution,
    )
    .slice(0, max);
  return [
    ...picked.filter((i) => i.contribution > 0),
    ...picked.filter((i) => i.contribution < 0),
  ].map((i) => ({
    key: i.key,
    text: reasonText(i, underwriterStat, context),
    tone: i.contribution > 0 ? "good" : "bad",
  }));
}

/** 画面の1行分。 */
export interface BbPick {
  ipo: Ipo;
  phase: BbPickPhase;
  /** BB 参加スコア（0〜100）。 */
  bbScore: number;
  /** 公募割れ確率（0〜1、実績ベース）。算出していない銘柄は null。 */
  breakEvenProbability: number | null;
  reasons: BbPickReason[];
  /** 共通チェックの集計（未計算は undefined）。 */
  checkCounts?: CheckpointCounts;
  /** 即金規制の可能性。 */
  instantCash?: InstantCashStatus;
}

/** 共通チェック・即金規制の判定に使う追加の材料。 */
export interface BbPickCheckContext {
  enrichedByCode: Readonly<Record<string, CheckpointEnriched>>;
  thresholds: CheckpointThresholds;
}

/**
 * 材料にスコアを付けて BB 参加スコアの高い順に並べる（クライアントで呼ぶ。設定の地合いを反映する）。
 * 並べ方は topBbCandidates と同じ（スコア降順、同点は上場日の早い順・未定は後ろ）。
 * 材料に対応する銘柄が ipos に無ければ飛ばす。
 */
export function rankBbPicks(
  ipos: Ipo[],
  inputs: readonly BbPickInput[],
  settings: ScoreSettings,
  check: BbPickCheckContext = { enrichedByCode: {}, thresholds: DEFAULT_THRESHOLDS },
): BbPick[] {
  const byCode = new Map(ipos.map((ipo) => [ipo.code, ipo]));
  const scored: BbPick[] = [];
  for (const input of inputs) {
    const ipo = byCode.get(input.code);
    if (!ipo) continue;
    const result = scoreBbParticipation(
      ipo,
      settings,
      input.underwriterStat,
      undefined,
      input.context,
    );
    scored.push({
      ipo,
      phase: input.phase,
      bbScore: result.score,
      breakEvenProbability: input.breakEvenProbability,
      reasons: bbPickReasons(result, input.underwriterStat, input.context),
      checkCounts: runCommonCheckpoints(
        { ipo, enriched: check.enrichedByCode[ipo.code] },
        check.thresholds,
      ).counts,
      instantCash: instantCashStatus(
        input.forecastRatio ?? null,
        ipo,
        null,
        check.thresholds.instantCashRegulationRatio,
      ),
    });
  }
  return topBbCandidates(scored, scored.length);
}
