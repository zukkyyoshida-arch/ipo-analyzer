import type { Ipo } from "@/types/ipo";
import type { CheckpointEnriched, CheckpointVerdict } from "@/lib/checkpoints/types";
import { actualPeriodsNewestFirst, periodSortKey } from "@/lib/checkpoints/common";
import { addDaysIso, daysBetween } from "@/lib/date";
import { splitFactor } from "@/lib/price";
import { currentTier, type MidFile, type MidItem, type MidTier } from "@/lib/midterm/file";
import { DEFAULT_THRESHOLDS, type CheckpointThresholds } from "@/lib/checkpoints/thresholds";
import { isFinsStale } from "@/lib/fins/file";
import { isMarginStale, marginRatio as calcMarginRatio } from "@/lib/margin/file";
import type { FinsFile, FinsItem } from "@/types/fins";
import type { MarginFile, MarginItem } from "@/types/margin";

// ホームの「ピックアップ」→「中長期セカンダリ」。上場後に大きく下げた IPO 銘柄の反発狙い。
// 夜間の midterm.json（上場来高値からの下落率・安値・出来高）に、銘柄データ（ロックアップ・業績・決算日・発行済株式数）
// を当ててチェックし、候補を並べる純関数。
//
// 既定値の根拠は過去検証 scratch/backtest/report-midterm.md（2024〜2026 上場 166 銘柄）:
// - 上場来高値から −60% に初めて届いた翌営業日の寄りで買い、20 営業日後の引けで売ると平均 +7.7%
//   （95% 信頼区間 +2.6〜+13.2%、勝率 54%、n=74）。−40%・−50% は根拠なし（段階表示だけ）。
// - 出来高の減少・安値からの反発の確認は効果なし（反発を待つとむしろ悪化）→ 判定に使わない。
// - 利確 +10%／損切り −10% を固定すると平均が +7.7% → +2.6% に下がる → 固定しない。
// - 初決算またぎは標本 3 件で検証できていない → 警告だけ。
//
// 講師の「10 のチェックポイント」（①業種業態 ②業績 ③財務 ④株主構成 ⑤ロックアップ ⑥時価総額 ⑦信用買残 ⑧出来高
// ⑨上場来高値からの下落 ⑩上場来安値からの戻り）を番号順に並べる。ただし過去検証 scratch/backtest/report-midterm-v2.md で
// 業績・財務・進捗率・出来高・時価総額のどれも −60% シグナルに足して有意に良くならず、pass 数が多いほど勝つにもならなかった。
// → 追加した項目（①③④⑦と J-Quants の業績）は候補から外す fail を出さない（pass/warn/unknown のみ）。講師基準の参考表示。
//   候補の定義（下落率 pass かつ fail なし）は変えない。

/** 検証の数字（注記に使う）。 */
export const MID_BACKTEST = {
  period: "2024〜2026 年上場の 166 銘柄",
  tier: 60,
  holdDays: 20,
  meanPct: 7.7,
  ciLowPct: 2.6,
  ciHighPct: 13.2,
  winRatePct: 54,
  n: 74,
  hold60MeanPct: 6.4,
  hold60WinRatePct: 58,
  fixedExitMeanPct: 2.6,
} as const;

/** 主基準（pass）の下落率（%）。 */
export const MID_PASS_TIER: MidTier = 60;
/** 注意（warn）の下落率（%）。 */
export const MID_WARN_TIER: MidTier = 50;
// 以下 3 つは既定値（設定の「手法のしきい値」→ 中長期セカンダリで変えられる。判定は thresholds を受け取って行う）。
/** 20 日平均出来高の下限（株）。これ以上で pass。 */
export const MID_VOLUME_PASS = DEFAULT_THRESHOLDS.midVolumePass;
/** 20 日平均出来高の最低ライン（株）。これ未満は fail、間は warn。 */
export const MID_VOLUME_MIN = DEFAULT_THRESHOLDS.midVolumeMin;
/** 時価総額の下限（億円）。これ以上で pass、下回ったら warn（候補からは外さない）。 */
export const MID_MARKET_CAP_MIN_OKU = DEFAULT_THRESHOLDS.midMarketCapMinOku;
/** ロックアップの既定日数（銘柄データに無いとき）。 */
export const MID_LOCKUP_DEFAULT_DAYS = 180;
/** 業績の基準（直近期）の既定値: 増収率・営業増益率・営業利益率（%）。 */
export const MID_GROWTH = {
  revenuePct: DEFAULT_THRESHOLDS.midGrowthRevenuePct,
  profitPct: DEFAULT_THRESHOLDS.midGrowthProfitPct,
  marginPct: DEFAULT_THRESHOLDS.midMarginPct,
} as const;
/** 保有の目安（営業日）と、それを暦日に直した日数（決算またぎの判定に使う）。 */
export const MID_HOLD_BUSINESS_DAYS = 20;
export const MID_HOLD_CALENDAR_DAYS = 28;
/** 四半期末から決算発表までの日数の目安（東証の要請は 45 日以内）。 */
export const MID_EARNINGS_LAG_DAYS = 45;

export type MidCheckId =
  | "industry"
  | "growth"
  | "progress"
  | "equityRatio"
  | "operatingCf"
  | "founderTop"
  | "lockupPassed"
  | "marketCap50"
  | "marginRatio"
  | "volumeFloor"
  | "drawdown"
  | "reboundFromLow"
  | "firstEarningsGap";

/** ①業種業態の目視判定（端末に保存）。◎=strong・○=ok・×=ng。 */
export type MidManualVerdict = "strong" | "ok" | "ng";

/** 判定の出典（詳細カードに出す）。 */
export type MidCheckSource = "J-Quants" | "JPX" | "目論見書" | "株価" | "目視";

export interface MidCheckResult {
  id: MidCheckId;
  label: string;
  verdict: CheckpointVerdict;
  /** この銘柄の値（表示用） */
  value: string;
  /** 判定の基準（表示用） */
  threshold: string;
  /** 行に出す短い根拠 */
  short: string;
  /** true なら表示だけで、候補・スコアに使わない */
  displayOnly?: boolean;
  /** 講師の 10 項目の番号（1〜10）。決算までのように番号の無い項目は省略 */
  no?: number;
  /** 出典 */
  source?: MidCheckSource;
  /** スコアの点を上書き（①目視の ○ は pass だが 1 点） */
  points?: number;
}

export interface MidCheckInput {
  item: MidItem;
  ipo?: Ipo;
  enriched?: CheckpointEnriched;
  todayIso: string;
  /** J-Quants の財務（古いファイルは渡さない＝不明扱い） */
  fins?: FinsItem;
  /** JPX の信用残（古いファイルは渡さない＝不明扱い） */
  margin?: MarginItem;
  /** ①業種業態の目視 */
  manual?: MidManualVerdict;
  /** しきい値（省略時は既定値＝講師基準） */
  thresholds?: CheckpointThresholds;
}

function th(input: MidCheckInput): CheckpointThresholds {
  return input.thresholds ?? DEFAULT_THRESHOLDS;
}

function pct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function pctNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

function md(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

function sharesJa(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000) / 10}万株` : `${Math.round(n).toLocaleString("ja-JP")}株`;
}

function okuJa(yen: number): string {
  const oku = yen / 1e8;
  const r = Math.abs(oku) >= 100 ? Math.round(oku) : Math.round(oku * 10) / 10;
  return `${r < 0 ? "−" : ""}${Math.abs(r)}億円`;
}

// ------------------------------------------------------------
// 各チェック
// ------------------------------------------------------------

export function checkDrawdown({ item }: MidCheckInput): MidCheckResult {
  const tier = currentTier(item.drawdown);
  const value = pct(item.drawdown);
  const threshold = `上場来高値から −${MID_PASS_TIER}% でクリア／−${MID_WARN_TIER}% は注意`;
  const base = { id: "drawdown" as const, label: "上場来高値からの下落", value, threshold, no: 9, source: "株価" as const };
  if (tier !== null && tier >= MID_PASS_TIER) {
    return { ...base, verdict: "pass", short: `高値から ${value}` };
  }
  if (tier !== null && tier >= MID_WARN_TIER) {
    return { ...base, verdict: "warn", short: `高値から ${value}（−${MID_PASS_TIER}% 手前）` };
  }
  return { ...base, verdict: "fail", short: `高値から ${value}（対象外）` };
}

export function checkReboundFromLow({ item }: MidCheckInput): MidCheckResult {
  return {
    id: "reboundFromLow",
    label: "上場来安値からの戻り",
    verdict: "unknown",
    value: pct(item.rebound),
    threshold: "表示だけ（反発の確認は検証で効果なし）",
    short: `安値から ${pct(item.rebound)}`,
    displayOnly: true,
    no: 10,
    source: "株価",
  };
}

export function checkVolumeFloor(input: MidCheckInput): MidCheckResult {
  const { item } = input;
  const t = th(input);
  const base = {
    id: "volumeFloor" as const,
    label: "20 日平均出来高",
    threshold: `${sharesJa(t.midVolumePass)}以上でクリア／${sharesJa(t.midVolumeMin)}未満は警戒`,
    no: 8,
    source: "株価" as const,
  };
  const v = item.avgVolume20;
  if (v === null) return { ...base, verdict: "unknown", value: "—", short: "出来高 不明" };
  const value = sharesJa(v);
  if (v >= t.midVolumePass) return { ...base, verdict: "pass", value, short: `出来高 ${value}/日` };
  if (v >= t.midVolumeMin) return { ...base, verdict: "warn", value, short: `出来高 ${value}/日と少なめ` };
  return { ...base, verdict: "fail", value, short: `出来高 ${value}/日で薄い` };
}

/**
 * いまの時価総額（億円）。
 * 1. J-Quants の期末発行済株式数（fins.fy.sharesOutstanding）× 終値。最新期末の株数なので分割後の株数である可能性が高く、
 *    分割係数は掛けない（期末より後の分割は反映されないが、上場時の株数に係数を掛けるより新しい）。
 * 2. 目論見書の発行済株式数 × 分割係数（Ipo があるときだけ）× 終値。
 * 3. 想定時価総額を値動きで補正。
 */
export function currentMarketCapOku(
  item: MidItem,
  ipo?: Ipo,
  enriched?: CheckpointEnriched,
  fins?: FinsItem,
): number | null {
  const finsShares = fins?.fy?.sharesOutstanding;
  if (typeof finsShares === "number" && finsShares > 0) return (finsShares * item.close) / 1e8;
  const issued = enriched?.issuedShares;
  const factor = ipo ? splitFactor(ipo) : 1;
  if (typeof issued === "number" && issued > 0) return (issued * factor * item.close) / 1e8;
  if (ipo && ipo.marketCap > 0 && typeof ipo.offeringPrice === "number" && ipo.offeringPrice > 0) {
    return (ipo.marketCap * item.close * factor) / ipo.offeringPrice;
  }
  return null;
}

export function checkMarketCap(input: MidCheckInput): MidCheckResult {
  const { item, ipo, enriched, fins } = input;
  const min = th(input).midMarketCapMinOku;
  const useFins = typeof fins?.fy?.sharesOutstanding === "number" && fins.fy.sharesOutstanding > 0;
  const base = {
    id: "marketCap50" as const,
    label: "時価総額",
    threshold: `${min}億円以上でクリア（下回っても候補から外さない）`,
    no: 6,
    source: (useFins ? "J-Quants" : "目論見書") as MidCheckSource,
  };
  const cap = currentMarketCapOku(item, ipo, enriched, fins);
  if (cap === null) return { ...base, verdict: "unknown", value: "—", short: "時価総額 不明" };
  const value = `${cap >= 100 ? Math.round(cap) : Math.round(cap * 10) / 10}億円`;
  if (cap >= min) return { ...base, verdict: "pass", value, short: `時価総額 ${value}` };
  return { ...base, verdict: "warn", value, short: `時価総額 ${value}と小さめ` };
}

export function checkLockupPassed({ item, ipo, enriched }: MidCheckInput, todayIso: string): MidCheckResult {
  const base = { id: "lockupPassed" as const, label: "ロックアップ", no: 5, source: "目論見書" as const };
  const listing = ipo?.listingDate || item.listingDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing)) {
    return { ...base, verdict: "unknown", value: "—", threshold: "解除済みでクリア", short: "ロック 不明" };
  }
  const holderDays = (enriched?.majorShareholders ?? [])
    .map((h) => h.lockupDays)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const own = ipo && ipo.lockup.days > 0 ? ipo.lockup.days : MID_LOCKUP_DEFAULT_DAYS;
  const days = Math.max(own, ...holderDays);
  const threshold = `上場から ${days} 日経過でクリア`;
  const elapsed = daysBetween(listing, todayIso);
  if (elapsed >= days) {
    return { ...base, verdict: "pass", value: `${days} 日経過`, threshold, short: "ロック解除済み" };
  }
  const left = days - elapsed;
  const releaseDate = addDaysIso(listing, days);
  return {
    ...base,
    verdict: "warn",
    value: `解除まで ${left} 日（${md(releaseDate)}）`,
    threshold,
    short: `ロック解除まで ${left} 日`,
  };
}

interface GrowthPair {
  rev: number;
  prevRev: number;
  op: number;
  prevOp: number;
  source: MidCheckSource;
  /** 対象の期（表示用） */
  period: string;
}

/** 業績の比較に使う 2 期。J-Quants（直近通期と前期）を優先し、前期が無ければ目論見書の 3 期分に戻る。 */
function growthPair(enriched?: CheckpointEnriched, fins?: FinsItem): GrowthPair | null {
  const fy = fins?.fy;
  const prev = fins?.prevFy;
  if (
    fy && prev &&
    typeof fy.sales === "number" && typeof fy.op === "number" &&
    typeof prev.sales === "number" && typeof prev.op === "number"
  ) {
    return { rev: fy.sales, prevRev: prev.sales, op: fy.op, prevOp: prev.op, source: "J-Quants", period: fy.period };
  }
  const periods = actualPeriodsNewestFirst(enriched?.financialHistory ?? []);
  if (periods.length < 2) return null;
  return {
    rev: periods[0].revenue as number,
    prevRev: periods[1].revenue as number,
    op: periods[0].operatingProfit as number,
    prevOp: periods[1].operatingProfit as number,
    source: "目論見書",
    period: periods[0].period,
  };
}

/**
 * ②業績。増収率・営業増益率・営業利益率。減収・営業赤字は fail（講師の中長期は業績重視なので候補から外す。本番 #23 からの既存挙動）。
 * 基準未達（増収率などが足りない）は warn に留める（過去検証で業績の数値基準に効果が無いため）。
 */
export function checkGrowth(input: MidCheckInput): MidCheckResult {
  const { enriched, fins } = input;
  const t = th(input);
  const pair = growthPair(enriched, fins);
  const base = {
    id: "growth" as const,
    label: "直近期の業績",
    threshold: `増収 ${t.midGrowthRevenuePct}%・営業増益 ${t.midGrowthProfitPct}%・営業利益率 ${t.midMarginPct}% 以上`,
    no: 2,
    source: pair?.source ?? ("目論見書" as MidCheckSource),
  };
  if (!pair) return { ...base, verdict: "unknown", value: "—", short: "業績 不明" };
  const { rev, prevRev, op, prevOp } = pair;
  const revGrowth = prevRev > 0 ? (rev / prevRev - 1) * 100 : null;
  const opGrowth = prevOp > 0 ? (op / prevOp - 1) * 100 : null;
  const margin = rev > 0 ? (op / rev) * 100 : null;
  const value = [
    revGrowth === null ? "増収率 —" : `増収 ${pctNum(revGrowth)}`,
    opGrowth === null ? (op > prevOp ? "営業益 改善" : "営業益 —") : `営業益 ${pctNum(opGrowth)}`,
    margin === null ? "利益率 —" : `利益率 ${pctNum(margin)}`,
  ].join("・") + `（${pair.source}）`;
  if (rev < prevRev || op < 0) {
    return { ...base, verdict: "fail", value, short: rev < prevRev ? "直近期 減収" : "直近期 営業赤字" };
  }
  const okRev = revGrowth !== null && revGrowth >= t.midGrowthRevenuePct;
  // 前期が赤字で黒字化したときは増益率が出せないので、黒字化を増益の基準クリアとみなす。
  const okOp = opGrowth !== null ? opGrowth >= t.midGrowthProfitPct : prevOp <= 0 && op > 0;
  const okMargin = margin !== null && margin >= t.midMarginPct;
  if (okRev && okOp && okMargin) {
    return { ...base, verdict: "pass", value, short: `増収 ${pctNum(revGrowth as number)}・利益率 ${pctNum(margin as number)}` };
  }
  const miss = [!okRev ? "増収率" : null, !okOp ? "増益率" : null, !okMargin ? "利益率" : null]
    .filter(Boolean)
    .join("・");
  return { ...base, verdict: "warn", value, short: `業績 ${miss}が基準未満` };
}

/** ②の補足: 最新四半期の通期予想に対する営業益の進捗（表示だけ。過去検証で予測力なし）。 */
export function checkProgress({ fins }: MidCheckInput): MidCheckResult {
  const q = fins?.latestQuarter;
  const base = {
    id: "progress" as const,
    label: "四半期の進捗",
    verdict: "unknown" as const,
    threshold: "表示だけ（按分の目安 1Q 25%・2Q 50%・3Q 75%。進捗率は検証で効果なし）",
    displayOnly: true,
    no: 2,
    source: "J-Quants" as const,
  };
  if (!q) return { ...base, value: "—", short: "進捗 不明" };
  const op = q.progressOpPct === null ? "—" : `${Math.round(q.progressOpPct * 10) / 10}%`;
  return {
    ...base,
    value: `${q.type} 進捗 営業益 ${op}（按分 25/50/75）`,
    short: `${q.type} 進捗 営業益 ${op}`,
  };
}

/** ③自己資本比率（J-Quants の直近通期）。下回っても warn（候補から外さない）。 */
export function checkEquityRatio(input: MidCheckInput): MidCheckResult {
  const t = th(input);
  const base = {
    id: "equityRatio" as const,
    label: "自己資本比率",
    threshold: `${t.midEquityRatioPassPct}% 以上でクリア／${t.midEquityRatioWarnPct}% 以上は注意`,
    no: 3,
    source: "J-Quants" as const,
  };
  const v = input.fins?.fy?.eqAR;
  if (typeof v !== "number") return { ...base, verdict: "unknown", value: "—", short: "自己資本比率 不明" };
  const value = pctNum(v);
  if (v >= t.midEquityRatioPassPct) return { ...base, verdict: "pass", value, short: `自己資本比率 ${value}` };
  if (v >= t.midEquityRatioWarnPct) return { ...base, verdict: "warn", value, short: `自己資本比率 ${value}` };
  return { ...base, verdict: "warn", value, short: `自己資本比率 ${value}と低い` };
}

/** ③営業キャッシュフロー（J-Quants の直近通期）。マイナスでも warn。 */
export function checkOperatingCf({ fins }: MidCheckInput): MidCheckResult {
  const base = {
    id: "operatingCf" as const,
    label: "営業キャッシュフロー",
    threshold: "直近通期がプラスでクリア",
    no: 3,
    source: "J-Quants" as const,
  };
  const v = fins?.fy?.cfo;
  if (typeof v !== "number") return { ...base, verdict: "unknown", value: "—", short: "営業CF 不明" };
  const value = `${v > 0 ? "+" : ""}${okuJa(v)}`;
  if (v > 0) return { ...base, verdict: "pass", value, short: "営業CF プラス" };
  return { ...base, verdict: "warn", value, short: "営業CF マイナス" };
}

export type TopHolderKind = "founder" | "assetCompany" | "vc" | "corporate";

// VC・金融（筆頭が VC なら売り圧力の懸念）
const VC_WORDS = [
  "投資事業", "組合", "ファンド", "キャピタル", "パートナーズ", "ベンチャー", "インベストメント", "銀行", "信託",
  "証券", "生命", "保険", "グロース", "ブレイン", "VENTURES", "Ventures", "VC",
];
// 英字の法人・ファンド（人名の一部に当たらないよう単語で見る）
const VC_LATIN = /(^|[^A-Za-z])(Ltd|LLC|L\.P\.|LP|Fund|Capital|Partners|Investments?|Inc|Corp|Corporation|Limited|Trust|Bank)([^A-Za-z]|$)/i;
// 資産管理会社らしい名前
const ASSET_WORDS = ["資産管理", "ホールディングス", "有限会社", "合同会社"];
// 法人らしい名前（個人名から外す）
const CORP_WORDS = [
  "株式会社", "有限会社", "合同会社", "（株）", "(株)", "カンパニー", "グループ", "工業", "製薬", "電機", "商事", "財団",
  "社団", "機構", "協会", "大学",
];

// 個人名と区別できない短い社名（実データで確認できたもの）
const KNOWN_COMPANY_SHORT = new Set<string>(["東芝", "花王", "ソニー", "日立", "三菱", "富士通", "任天堂", "電通", "味の素", "トヨタ", "パナソニック"]);

/**
 * ④筆頭株主の名前から、創業者（個人）・資産管理会社・VC/金融・事業会社を見分ける（機械判定の目安）。
 * - VC/金融の語（投資事業・組合・ファンド・キャピタル・パートナーズ・銀行・信託・Ltd・LLC・L.P. など）→ vc
 * - 資産管理会社らしい語（資産管理・ホールディングス・有限会社・合同会社）→ assetCompany
 * - 法人の語を含まず、「姓 名」（空白区切り）またはかな・カナ・漢字のみ 2〜5 文字 → founder（個人名）
 * - それ以外 → corporate（事業会社）
 */
export function classifyTopHolder(name: string): TopHolderKind {
  const n = name.trim();
  if (VC_WORDS.some((w) => n.includes(w)) || VC_LATIN.test(n)) return "vc";
  if (ASSET_WORDS.some((w) => n.includes(w)) || /(^|[^A-Za-z])Holdings([^A-Za-z]|$)/i.test(n)) return "assetCompany";
  if (CORP_WORDS.some((w) => n.includes(w))) return "corporate";
  // 個人名は「姓 名（空白あり）」か「かな・カナ・漢字のみ 2〜5 文字」に限る（短い社名「東芝」「ソニー」等の誤判定を避ける）
  if (/^[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF々]{1,4}[\s　]+[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF々]{1,5}$/.test(n)) return "founder";
  if (/^[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF々]{2,5}$/.test(n) && !KNOWN_COMPANY_SHORT.has(n)) return "founder";
  return "corporate";
}

/** ④株主構成: 筆頭株主（比率が最大）が創業者・資産管理会社なら pass、VC・事業会社なら warn。 */
export function checkFounderTop({ enriched }: MidCheckInput): MidCheckResult {
  const base = {
    id: "founderTop" as const,
    label: "筆頭株主",
    threshold: "創業者・資産管理会社が筆頭でクリア（外国人株主の増加は有報で確認）",
    no: 4,
    source: "目論見書" as const,
  };
  const holders = enriched?.majorShareholders ?? [];
  if (holders.length === 0) return { ...base, verdict: "unknown", value: "—", short: "筆頭株主 不明" };
  const top = holders.reduce((a, b) => (b.ratioPercent > a.ratioPercent ? b : a));
  const kind = classifyTopHolder(top.name);
  const value = `${top.name}（${pctNum(top.ratioPercent)}）`;
  if (kind === "founder" || kind === "assetCompany") {
    return { ...base, verdict: "pass", value, short: `筆頭は創業者系（${top.name}）` };
  }
  const what = kind === "vc" ? "VC・金融" : "事業会社";
  return { ...base, verdict: "warn", value, short: `筆頭は${what}（${top.name}）` };
}

/** ⑦信用買残 ÷ 20 日平均出来高。重くても warn（候補から外さない）。 */
export function checkMarginRatio(input: MidCheckInput): MidCheckResult {
  const t = th(input);
  const base = {
    id: "marginRatio" as const,
    label: "信用買残",
    threshold: `出来高の ${t.midMarginRatioPassX} 倍以下でクリア／${t.midMarginRatioWarnX} 倍以下は注意`,
    no: 7,
    source: "JPX" as const,
  };
  const m = input.margin;
  const ratio = m ? calcMarginRatio(m.buy, input.item.avgVolume20) : null;
  if (!m || ratio === null) return { ...base, verdict: "unknown", value: "—", short: "信用残 不明" };
  const x = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  const value = `${x}倍（買残 ${sharesJa(m.buy)}）`;
  if (ratio <= t.midMarginRatioPassX) return { ...base, verdict: "pass", value, short: `信用買残 出来高の ${x} 倍` };
  if (ratio <= t.midMarginRatioWarnX) return { ...base, verdict: "warn", value, short: `信用買残 出来高の ${x} 倍` };
  return { ...base, verdict: "warn", value, short: `信用買残が出来高の ${x} 倍と重い` };
}

/** ①業種業態（目視）。◎ は pass 2 点、○ は pass 1 点、× は warn、未設定は不明。 */
export function checkIndustry({ manual }: MidCheckInput): MidCheckResult {
  const base = {
    id: "industry" as const,
    label: "業種業態",
    threshold: "オンリーワン・ニッチトップ・グローバル（目視で ◎○× を付ける）",
    no: 1,
    source: "目視" as const,
  };
  if (manual === "strong") return { ...base, verdict: "pass", value: "◎", short: "目視◎" };
  if (manual === "ok") return { ...base, verdict: "pass", value: "○", short: "目視○", points: 1 };
  if (manual === "ng") return { ...base, verdict: "warn", value: "×", short: "目視×" };
  return { ...base, verdict: "unknown", value: "未設定", short: "目視 未設定" };
}

/**
 * 次の決算日の推定（決算期の月から四半期末を出し、その MID_EARNINGS_LAG_DAYS 日後を「ごろまで」とする）。
 * 今日以降で最初の推定日を返す。決算期が読めなければ null。
 */
export function estimateNextEarnings(
  enriched: CheckpointEnriched | undefined,
  todayIso: string,
  fins?: FinsItem,
): string | null {
  const keys = (enriched?.financialHistory ?? [])
    .map((p) => periodSortKey(p.period))
    .filter((k): k is number => k !== null);
  // 目論見書の決算期が無ければ J-Quants の決算期末（YYYY-MM）の月を使う。
  const finsMonth = fins?.fy?.period ? Number(fins.fy.period.slice(5, 7)) : NaN;
  if (keys.length === 0 && !(finsMonth >= 1 && finsMonth <= 12)) return null;
  const fyMonth = keys.length > 0 ? Math.max(...keys) % 100 : finsMonth;
  if (!(fyMonth >= 1 && fyMonth <= 12)) return null;
  const year = Number(todayIso.slice(0, 4));
  // 前年〜翌年の四半期末を順に見て、発表の目安日が今日以降の最初のものを取る。
  const candidates: string[] = [];
  for (let y = year - 1; y <= year + 1; y++) {
    for (let q = 0; q < 4; q++) {
      const m0 = ((fyMonth - 1 + q * 3) % 12) + 1;
      // 月末日: 翌月 1 日の前日
      const next = m0 === 12 ? `${y + 1}-01-01` : `${y}-${String(m0 + 1).padStart(2, "0")}-01`;
      candidates.push(addDaysIso(addDaysIso(next, -1), MID_EARNINGS_LAG_DAYS));
    }
  }
  return candidates.sort().find((d) => d >= todayIso) ?? null;
}

export function checkFirstEarningsGap({ ipo, enriched, fins }: MidCheckInput, todayIso: string): MidCheckResult {
  const base = {
    id: "firstEarningsGap" as const,
    label: "決算まで",
    threshold: `保有の目安（${MID_HOLD_BUSINESS_DAYS} 営業日≒${MID_HOLD_CALENDAR_DAYS} 日）の間に決算が来なければクリア`,
  };
  const known = ipo?.firstEarningsDate;
  const hasKnown = typeof known === "string" && /^\d{4}-\d{2}-\d{2}$/.test(known) && known >= todayIso;
  const date = hasKnown ? (known as string) : estimateNextEarnings(enriched, todayIso, fins);
  if (!date) return { ...base, verdict: "unknown", value: "—", short: "決算日 不明" };
  const days = daysBetween(todayIso, date);
  const tag = hasKnown ? "" : "（推定）";
  const value = hasKnown ? `${md(date)}（${days} 日後）` : `${md(date)} ごろまで${tag}（${days} 日以内）`;
  if (days <= MID_HOLD_CALENDAR_DAYS) {
    return { ...base, verdict: "warn", value, short: `決算 ${md(date)}${tag}をまたぐ` };
  }
  return { ...base, verdict: "pass", value, short: `決算まで ${days} 日${tag}` };
}

/** 全チェック（講師の番号順。最後に番号の無い「決算まで」）。 */
export function runMidChecks(input: MidCheckInput): MidCheckResult[] {
  return [
    checkIndustry(input),
    checkGrowth(input),
    checkProgress(input),
    checkEquityRatio(input),
    checkOperatingCf(input),
    checkFounderTop(input),
    checkLockupPassed(input, input.todayIso),
    checkMarketCap(input),
    checkMarginRatio(input),
    checkVolumeFloor(input),
    checkDrawdown(input),
    checkReboundFromLow(input),
    checkFirstEarningsGap(input, input.todayIso),
  ];
}

// ------------------------------------------------------------
// 並べる
// ------------------------------------------------------------

export interface MidReason {
  id: MidCheckId;
  text: string;
  tone: "good" | "warn" | "bad";
}

export interface MidSecondaryPick {
  item: MidItem;
  ipo?: Ipo;
  checks: MidCheckResult[];
  /** いま届いている一番深い段階 */
  tier: MidTier | null;
  /** 候補（下落率がクリアで、警戒が 1 つも無い） */
  candidate: boolean;
  /** 並べ替えのスコア（クリア 2 点・注意 1 点。表示だけの項目と下落率は数えない） */
  score: number;
  /** 行に出す根拠（最大 3 つ。警戒 → 注意 → クリアの順で拾う） */
  reasons: MidReason[];
  /** −60% の初到達日から今日までの暦日数（未到達は null） */
  daysSincePassHit: number | null;
  /** ①業種業態の目視（未設定は undefined） */
  manual?: MidManualVerdict;
  /** 講師の 10 項目のうち pass の数（表示だけの項目と決算までは数えない。目視 ○ も 1 と数える） */
  passCount: number;
  /** 講師の 10 項目のうち判定できた数（unknown・表示だけを除く） */
  checkTotal: number;
}

const REASON_TONE = { pass: "good", warn: "warn", fail: "bad" } as const;

/** 行に出す根拠（下落率と表示だけの項目は除く）。 */
export function midReasons(checks: readonly MidCheckResult[], max = 3): MidReason[] {
  const pool = checks.filter((c) => c.id !== "drawdown" && !c.displayOnly && c.verdict !== "unknown");
  const order: CheckpointVerdict[] = ["fail", "warn", "pass"];
  return order
    .flatMap((v) => pool.filter((c) => c.verdict === v))
    .slice(0, max)
    .map((c) => ({ id: c.id, text: c.short, tone: REASON_TONE[c.verdict as "pass" | "warn" | "fail"] }));
}

function scoreOf(checks: readonly MidCheckResult[]): number {
  return checks
    .filter((c) => c.id !== "drawdown" && !c.displayOnly)
    .reduce((s, c) => s + (c.points ?? (c.verdict === "pass" ? 2 : c.verdict === "warn" ? 1 : 0)), 0);
}

/** 講師の 10 項目のクリア数と判定数（unknown・表示だけ・番号の無い項目は除く）。 */
export function midPassCount(checks: readonly MidCheckResult[]): { passCount: number; checkTotal: number } {
  const judged = checks.filter((c) => c.no !== undefined && !c.displayOnly && c.verdict !== "unknown");
  return { passCount: judged.filter((c) => c.verdict === "pass").length, checkTotal: judged.length };
}

/** rankMidSecondary の追加データ（どれも省略可）。 */
export interface MidSecondaryExtra {
  /** fins.json（古ければ使わない＝該当チェックは不明） */
  fins?: FinsFile | null;
  /** margin.json（古ければ使わない＝該当チェックは不明） */
  margin?: MarginFile | null;
  /** ①業種業態の目視（code → ◎○×） */
  manual?: Readonly<Record<string, MidManualVerdict>>;
  /** しきい値（省略時は既定値） */
  thresholds?: CheckpointThresholds;
}

/** 古くない fins.json だけを返す（古い・無いなら null）。 */
export function freshFins(file: FinsFile | null | undefined, todayIso: string): FinsFile | null {
  return file && file.asOf && !isFinsStale(file.asOf, todayIso) ? file : null;
}

/** 古くない margin.json だけを返す（古い・無いなら null）。 */
export function freshMargin(file: MarginFile | null | undefined, todayIso: string): MarginFile | null {
  return file && file.asOf && !isMarginStale(file.asOf, todayIso) ? file : null;
}

/**
 * midterm.json の各行にチェックを当てて並べる（クライアントで呼ぶ）。
 * 並びは 候補 → それ以外、その中でスコアの高い順 → 下落率の深い順 → コード順。
 * @param ipos 現行データの全銘柄（ロックアップ・決算日・分割係数に使う。無い銘柄は該当項目が不明になる）
 * @param file midterm.json（無ければ空）
 * @param enrichedByCode 補完データ（業績・発行済株式数・大株主のロック）
 * @param todayIso 日本時間の今日
 * @param extra 財務（fins.json）・信用残（margin.json）・目視・しきい値（省略可。古いファイルは不明扱い）
 */
export function rankMidSecondary(
  ipos: readonly Ipo[],
  file: MidFile | null,
  enrichedByCode: Readonly<Record<string, CheckpointEnriched>>,
  todayIso: string,
  extra: MidSecondaryExtra = {},
): MidSecondaryPick[] {
  if (!file) return [];
  const byCode = new Map(ipos.map((ipo) => [ipo.code, ipo]));
  const fins = freshFins(extra.fins, todayIso);
  const margin = freshMargin(extra.margin, todayIso);
  const picks = file.items.map((item): MidSecondaryPick => {
    const ipo = byCode.get(item.code);
    const checks = runMidChecks({
      item,
      ipo,
      enriched: enrichedByCode[item.code],
      todayIso,
      fins: fins?.items[item.code],
      margin: margin?.items[item.code],
      manual: extra.manual?.[item.code],
      thresholds: extra.thresholds,
    });
    const drawdown = checks.find((c) => c.id === "drawdown") as MidCheckResult;
    const passHit = item.hits[`${MID_PASS_TIER}`];
    return {
      item,
      ipo,
      checks,
      tier: currentTier(item.drawdown),
      candidate: drawdown.verdict === "pass" && checks.every((c) => c.verdict !== "fail"),
      score: scoreOf(checks),
      reasons: midReasons(checks),
      daysSincePassHit: passHit ? daysBetween(passHit, todayIso) : null,
      manual: extra.manual?.[item.code],
      ...midPassCount(checks),
    };
  });
  return picks.sort(
    (a, b) =>
      Number(b.candidate) - Number(a.candidate) ||
      b.score - a.score ||
      a.item.drawdown - b.item.drawdown ||
      a.item.code.localeCompare(b.item.code),
  );
}

/** 「7月10日」の形（注記の「財務 ○月○日時点」に使う）。読めなければそのまま。 */
export function monthDayJa(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[1])}月${Number(m[2])}日` : iso;
}
