// 大量保有報告書の「注目度」と銘柄の選定。純関数（Date.now を使わない。今日は todayIso で受け取る）。
// 入力は holdings.json（./file.ts の parseHoldingsFile で読んだもの）。
// scripts（tsx）からも読めるよう、実行時に読むモジュールは相対パスで import する。
//
// 考え方: 1 件の提出ごとに「点」をつけ、提出日からの経過で減衰させて銘柄ごとに足す。
// 足した値を −100〜+100 に丸めたものが注目度。正は買い手の動き、負は売り手の動き（注意）。
// 重みはすべて設計値（過去検証はまだしていない）。法令などの根拠があるところはその旨を書く。
//
// 1 件の点:
// - 新規 5% 超（大量保有報告書。上場に伴う報告は除く）: +40。保有割合が 5% を超えた分 1pt ごとに +1（最大 +15）。
//   新しい大株主が現れた＝発行会社に意思を持つ買い手が来た兆しとして、いちばん重く見る（設計値）。
// - 買い増し（変更報告書で +1pt 以上）: +20。1pt を超えた分 1pt ごとに +5（最大 +20）。
//   1pt は変更報告書の提出義務の基準（金融商品取引法 27 条の 25: 保有割合が 1% 以上増減したら提出）。点は設計値。
// - 保有目的の加点（新規・買い増しのときだけ。当てはまるうち最も大きい 1 つ）:
//   事業上の提携（資本業務提携など）+20／経営参加・子会社化など +20／重要提案行為等 +15（設計値）。
// - 減少（変更報告書で −1pt 以下）: −20。1pt を超えた分 1pt ごとに −5（最大 −40）（設計値）。
// - 5% 割れ（前回 5% 以上 → 今回 5% 未満）: −50（減少の点と比べて小さい＝より負の方）。
//   5% を割るとその後の売却は報告されなくなるので、VC などが持ち分を手放しきる段階として重く見る（設計値）。
// - 短期大量譲渡（変更報告書（短期大量譲渡））: −40（減少の点と比べて小さい方）（設計値）。
// - 特例対象（証券会社・運用会社などの特例報告）: 上の点を半分にする。運用・貸株・売買仲介の結果であることが多く、
//   発行会社に対する意思のある売買の兆しとしては弱いため（設計値）。
// - 上場に伴う報告（大量保有報告書で、報告義務発生日が上場日の前日〜14 日後）: 0 点。
//   上場で創業者・VC・事業会社などの既存株主に報告義務が生じただけで、新しい買いではないため。
//   14 日は「上場日に義務が発生し、5 営業日以内に提出」を暦日で包む幅（設計値）。
// - 保有割合が 1pt 未満しか動いていない変更報告書（契約・保有目的の変更など）: 0 点。
// - 公開買付の記載（保有目的・提出事由に「公開買付」）: 0 点。理由の表示だけに使う。
//
// 減衰: 重み = 0.5 ^ (経過日数 ÷ 30)。90 日より前の提出は数えない（どちらも設計値）。
//   報告は義務発生から最大 5 営業日遅れて出るので、提出日の時点で動きの一部は株価に織り込まれている可能性がある。
// 注目度 = Σ 重み × 点 を −100〜+100 に収めて四捨五入した整数。
//   +10 以上を「注目」、−10 以下を「注意」とする（設計値）。

import { daysBetween } from "../date";
import { isHoldingsStale } from "./file";
import { HOLDINGS_SOURCE_TEXT, type HoldingItem, type HoldingsFile } from "./types";

/** 減衰の半減期（日）。 */
export const HOLDINGS_HALF_LIFE_DAYS = 30;
/** 注目度に数える期間（提出日から、暦日）。 */
export const HOLDINGS_SCORE_WINDOW_DAYS = 90;
/** 上場に伴う報告とみなす幅（報告義務発生日が上場日の何日前〜何日後か）。 */
export const HOLDINGS_LISTING_REPORT_WINDOW = { before: 1, after: 14 } as const;
/** 5% ルール（大量保有報告の基準）。 */
export const HOLDINGS_THRESHOLD_RATIO = 0.05;
/** 変更報告書の提出基準（1pt）。 */
export const HOLDINGS_CHANGE_STEP = 0.01;

/** 1 件の点の重み（設計値。意味は冒頭のコメント）。 */
export const HOLDINGS_POINTS = {
  newHolder: 40,
  /** 5% を超えた分 1pt ごと */
  newHolderPerPt: 1,
  newHolderExtraMax: 15,
  increase: 20,
  /** 1pt を超えた分 1pt ごと */
  increasePerPt: 5,
  increaseExtraMax: 20,
  alliance: 20,
  control: 20,
  activist: 15,
  decrease: -20,
  decreasePerPt: -5,
  decreaseExtraMin: -20,
  below5: -50,
  bulkTransfer: -40,
  /** 特例対象の倍率 */
  specialFactor: 0.5,
} as const;

/** 注目・注意の境目（注目度）。 */
export const HOLDINGS_TONE_THRESHOLD = 10;
/** 注目度の上限・下限。 */
export const HOLDINGS_SCORE_LIMIT = 100;
/** 選定の既定の件数。 */
export const HOLDINGS_PICK_LIMIT = 10;
/** 1 銘柄に付ける提出の件数の上限（新しい順）。 */
export const HOLDINGS_PICK_MAX_FILINGS = 5;
/** 理由チップの最大数。 */
export const HOLDINGS_MAX_REASONS = 3;

const EPSILON = 1e-9;

export type HoldingSignalKind =
  | "newHolder"
  | "increase"
  | "alliance"
  | "control"
  | "activist"
  | "pureInvestment"
  | "decrease"
  | "below5"
  | "bulkTransfer"
  | "listing"
  | "tenderOffer";

/** 1 件の提出から読み取った動き（理由チップの素）。 */
export interface HoldingSignal {
  kind: HoldingSignalKind;
  /** 表示用の短い文言（例「新規 16.4%」「買い増し +2.1pt」「5%割れ」） */
  label: string;
}

/** 点をつけた 1 件の提出。 */
export interface ScoredHoldingFiling {
  item: HoldingItem;
  /** 減衰前の点 */
  points: number;
  /** 減衰の重み（0〜1） */
  weight: number;
  /** 提出日からの経過日数（未来日は 0） */
  elapsedDays: number;
  signals: HoldingSignal[];
}

export type HoldingTone = "positive" | "caution" | "neutral";

/** 1 銘柄のまとめ。 */
export interface HoldingPick {
  code: string;
  name: string;
  /** 注目度（−100〜+100 の整数。正は買い手の動き、負は売り手の動き） */
  score: number;
  tone: HoldingTone;
  /** 最新の提出 */
  latest: HoldingItem;
  /** 数えた提出（新しい順、最大 HOLDINGS_PICK_MAX_FILINGS 件） */
  filings: ScoredHoldingFiling[];
  /** 理由（効いた順、最大 HOLDINGS_MAX_REASONS 件） */
  reasons: string[];
}

/** pickHoldings の結果。 */
export interface HoldingsPicks {
  /** 取得済みの最新の提出日（""＝未取得） */
  coveredThrough: string;
  /** データが古い（更新待ち）か */
  stale: boolean;
  /** 注目（注目度の高い順） */
  picks: HoldingPick[];
  /** 注意（注目度の低い順） */
  cautions: HoldingPick[];
  /** 出典表記（画面に必ず出す） */
  source: string;
}

// ---------------------------------------------------------------------------
// 保有目的の読み取り
// ---------------------------------------------------------------------------

/** 「〜は行わない」「予定していない」のような打ち消しが直後に続くか。 */
function isNegatedAfter(text: string, end: number): boolean {
  const tail = text.slice(end, end + 20);
  return /^[^。]*?(ない|なく|ません|せず|予定して(い)?ない|行わない)/.test(tail);
}

/** pattern に当たる箇所のうち、打ち消されていないものが 1 つでもあるか。 */
function mentions(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!isNegatedAfter(text, m.index + m[0].length)) return true;
  }
  return false;
}

/** 保有目的から読み取れる意図。 */
export interface PurposeFlags {
  /** 事業上の提携（資本業務提携・業務提携など） */
  alliance: boolean;
  /** 経営参加・子会社化など */
  control: boolean;
  /** 重要提案行為等（アクティビスト的な関与） */
  activist: boolean;
  /** 純投資（投資収益性を重視した保有。ホームの「大量保有」ピックアップで加点に使う） */
  pureInvestment: boolean;
}

/** 保有目的の文から意図を読む。proposal は CSV の「重要提案行為等」欄に記載があったか。 */
export function classifyPurpose(purpose: string, proposal = false): PurposeFlags {
  const text = purpose.normalize("NFKC");
  return {
    alliance: mentions(text, /提携/),
    control: mentions(text, /経営(へ|に)?の?(参加|参画)|経営権|支配|子会社化|連結子会社|グループ化/),
    activist: proposal || mentions(text, /重要提案行為|株主提案/),
    pureInvestment: mentions(text, /純投資|投資収益/),
  };
}

/** 上場に伴う報告（上場で既存株主に報告義務が生じただけのもの）か。 */
export function isListingTimeReport(item: HoldingItem): boolean {
  if (item.formType !== "new" && item.formType !== "newSpecial") return false;
  if (!item.listingDate) return false;
  const base = item.obligationDate || item.submitDate;
  const diff = daysBetween(item.listingDate, base);
  return diff >= -HOLDINGS_LISTING_REPORT_WINDOW.before && diff <= HOLDINGS_LISTING_REPORT_WINDOW.after;
}

function ratioPct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

function deltaPt(delta: number): string {
  const pt = Math.round(delta * 1000) / 10;
  return `${pt >= 0 ? "+" : "−"}${Math.abs(pt).toFixed(1)}pt`;
}

// ---------------------------------------------------------------------------
// 1 件の点
// ---------------------------------------------------------------------------

/** 減衰前の点と読み取った動き。 */
export function holdingFilingPoints(item: HoldingItem): { points: number; signals: HoldingSignal[] } {
  const P = HOLDINGS_POINTS;
  const signals: HoldingSignal[] = [];
  const isNew = item.formType === "new" || item.formType === "newSpecial";
  const isSpecial = item.formType === "newSpecial" || item.formType === "changeSpecial";
  let points = 0;

  if (isNew && isListingTimeReport(item)) {
    signals.push({ kind: "listing", label: "上場時の報告" });
  } else if (isNew) {
    const extra =
      item.ratio === null
        ? 0
        : Math.min(
            P.newHolderExtraMax,
            Math.max(0, (item.ratio - HOLDINGS_THRESHOLD_RATIO) * 100 * P.newHolderPerPt),
          );
    points = P.newHolder + extra;
    signals.push({
      kind: "newHolder",
      label: item.ratio === null ? "新規 5%超" : `新規 ${ratioPct(item.ratio)}`,
    });
  } else {
    const d = item.delta;
    if (d !== null && d >= HOLDINGS_CHANGE_STEP - EPSILON) {
      const extraPt = (d - HOLDINGS_CHANGE_STEP) * 100;
      points = P.increase + Math.min(P.increaseExtraMax, Math.max(0, extraPt * P.increasePerPt));
      signals.push({ kind: "increase", label: `買い増し ${deltaPt(d)}` });
    } else if (d !== null && d <= -HOLDINGS_CHANGE_STEP + EPSILON) {
      const extraPt = (-d - HOLDINGS_CHANGE_STEP) * 100;
      points = P.decrease + Math.max(P.decreaseExtraMin, Math.min(0, extraPt * P.decreasePerPt));
      signals.push({ kind: "decrease", label: `減少 ${deltaPt(d)}` });
    }
    const crossedBelow =
      item.ratio !== null &&
      item.ratio < HOLDINGS_THRESHOLD_RATIO - EPSILON &&
      (item.prevRatio === null || item.prevRatio >= HOLDINGS_THRESHOLD_RATIO - EPSILON);
    if (crossedBelow) {
      points = Math.min(points, P.below5);
      signals.push({ kind: "below5", label: "5%割れ" });
    }
    if (item.formType === "bulkTransfer") {
      points = Math.min(points, P.bulkTransfer);
      signals.push({ kind: "bulkTransfer", label: "短期大量譲渡" });
    }
  }

  // 保有目的の加点は、新規（上場に伴う報告を除く）と買い増しのときだけ
  if (points > 0) {
    const flags = classifyPurpose(item.purpose, item.proposal === true);
    const bonuses: { kind: HoldingSignalKind; label: string; value: number }[] = [];
    if (flags.alliance) bonuses.push({ kind: "alliance", label: "事業提携", value: P.alliance });
    if (flags.control) bonuses.push({ kind: "control", label: "経営参加", value: P.control });
    if (flags.activist) bonuses.push({ kind: "activist", label: "重要提案", value: P.activist });
    if (bonuses.length > 0) {
      const best = bonuses.reduce((a, b) => (b.value > a.value ? b : a));
      points += best.value;
      for (const b of bonuses) signals.push({ kind: b.kind, label: b.label });
    }
  }

  if (/公開買付/.test(`${item.purpose}${item.reason}`.normalize("NFKC"))) {
    signals.push({ kind: "tenderOffer", label: "公開買付の記載" });
  }

  if (isSpecial) points *= P.specialFactor;
  return { points, signals };
}

/** 減衰の重み = 0.5 ^ (経過日数 ÷ 半減期)。経過日数が負（未来日）なら 1。 */
export function holdingDecayWeight(elapsedDays: number, halfLifeDays = HOLDINGS_HALF_LIFE_DAYS): number {
  return Math.pow(0.5, Math.max(0, elapsedDays) / halfLifeDays);
}

/** 提出日からの経過で減衰させた 1 件。数える期間の外なら null。 */
export function scoreHoldingFiling(item: HoldingItem, todayIso: string): ScoredHoldingFiling | null {
  const elapsed = daysBetween(item.submitDate, todayIso);
  if (!Number.isFinite(elapsed) || elapsed > HOLDINGS_SCORE_WINDOW_DAYS) return null;
  const elapsedDays = Math.max(0, elapsed);
  const weight = holdingDecayWeight(elapsedDays);
  const { points, signals } = holdingFilingPoints(item);
  return { item, points, weight, elapsedDays, signals };
}

// ---------------------------------------------------------------------------
// 銘柄ごとのまとめと選定
// ---------------------------------------------------------------------------

export function holdingTone(score: number): HoldingTone {
  if (score >= HOLDINGS_TONE_THRESHOLD) return "positive";
  if (score <= -HOLDINGS_TONE_THRESHOLD) return "caution";
  return "neutral";
}

/** 効いた順（|重み×点| の大きい順、同じなら新しい順）に理由の文言を並べ、重複を除いて上限まで返す。 */
export function holdingReasons(filings: readonly ScoredHoldingFiling[]): string[] {
  const ranked = filings
    .flatMap((f, order) =>
      f.signals.map((s) => ({ label: s.label, impact: Math.abs(f.weight * f.points), order })),
    )
    .sort((a, b) => b.impact - a.impact || a.order - b.order);
  const out: string[] = [];
  for (const r of ranked) {
    if (out.includes(r.label)) continue;
    out.push(r.label);
    if (out.length >= HOLDINGS_MAX_REASONS) break;
  }
  return out;
}

/**
 * 銘柄ごとに直近の動きをまとめて注目度を出す（数える期間内に提出がある銘柄だけ）。
 * 並びは注目度の高い順 → 最新の提出日の新しい順 → 銘柄コードの昇順。
 */
export function summarizeHoldings(items: readonly HoldingItem[], todayIso: string): HoldingPick[] {
  const byCode = new Map<string, ScoredHoldingFiling[]>();
  for (const item of items) {
    const scored = scoreHoldingFiling(item, todayIso);
    if (!scored) continue;
    const list = byCode.get(item.code) ?? [];
    list.push(scored);
    byCode.set(item.code, list);
  }
  const picks: HoldingPick[] = [];
  for (const [code, filings] of byCode) {
    filings.sort(
      (a, b) =>
        a.elapsedDays - b.elapsedDays ||
        (a.item.docId < b.item.docId ? 1 : a.item.docId > b.item.docId ? -1 : 0),
    );
    const raw = filings.reduce((sum, f) => sum + f.weight * f.points, 0);
    const score = Math.round(Math.min(HOLDINGS_SCORE_LIMIT, Math.max(-HOLDINGS_SCORE_LIMIT, raw)));
    const latest = filings[0].item;
    picks.push({
      code,
      name: latest.name,
      score,
      tone: holdingTone(score),
      latest,
      filings: filings.slice(0, HOLDINGS_PICK_MAX_FILINGS),
      reasons: holdingReasons(filings),
    });
  }
  return picks.sort(
    (a, b) =>
      b.score - a.score ||
      (a.latest.submitDate < b.latest.submitDate ? 1 : a.latest.submitDate > b.latest.submitDate ? -1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
}

export interface PickHoldingsOptions {
  /** 注目・注意それぞれの件数（既定 HOLDINGS_PICK_LIMIT） */
  limit?: number;
}

/**
 * 画面用の選定。file が null・空・古くても落ちない（空の結果か、stale: true を返す）。
 * - picks: 注目度 +10 以上を高い順
 * - cautions: 注目度 −10 以下を低い順（VC などの売り・5% 割れ）
 */
export function pickHoldings(
  file: HoldingsFile | null,
  todayIso: string,
  options: PickHoldingsOptions = {},
): HoldingsPicks {
  const limit = Math.max(0, Math.floor(options.limit ?? HOLDINGS_PICK_LIMIT));
  const all = file ? summarizeHoldings(file.items, todayIso) : [];
  return {
    coveredThrough: file?.coveredThrough ?? "",
    stale: isHoldingsStale(file, todayIso),
    picks: all.filter((p) => p.tone === "positive").slice(0, limit),
    cautions: all
      .filter((p) => p.tone === "caution")
      .sort((a, b) => a.score - b.score || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .slice(0, limit),
    source: HOLDINGS_SOURCE_TEXT,
  };
}
