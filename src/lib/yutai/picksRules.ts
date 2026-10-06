// 優待先回り買いの「検証ルールの候補」（public/data/yutai/picks.json）の型・読み込み時の検証・ルール判定。純関数。
// 生成は scripts/updater/yutai-picks-main.ts（夜間ジョブ。日足キャッシュから同時期の過去成績を集計する）。
// 検証の中身は scripts/backtest/yutai/REPORT.md（手法: 権利付最終日の N 営業日前に買い、権利付最終日の大引けで売る）。

import { addDaysIso, daysBetween } from "../date";
import { isBusinessDay } from "../calendar/businessDays";
import { nextYutaiSchedule } from "../calendar/yutaiDates";

/** ルール名。B は C をさらに絞ったもの。 */
export type PickRule = "B" | "C" | "D";

/** ルールの並び（画面のチップの順）。 */
export const PICK_RULES: readonly PickRule[] = ["B", "C", "D"] as const;

/** ルールのしきい値（scripts/backtest/yutai/basket.mts・live.mts と同じ）。 */
export const PICK_RULE_THRESHOLDS = {
  /** C: 同時期の過去勝率 ≥70%（5 年以上）× 100 株 ≤20 万円 × 市場 1 か月マイナス */
  C: { minN: 5, minRate: 0.7, maxInvest: 200_000, needMarketDown: true },
  /** D: 過去勝率 ≥80%（8 年以上）× 100 株 ≤20 万円（市場条件なし） */
  D: { minN: 8, minRate: 0.8, maxInvest: 200_000, needMarketDown: false },
  /** B: C に加えて 100 株 ≤10 万円 × 75 日線の下 */
  B: { minN: 5, minRate: 0.7, maxInvest: 100_000, needMarketDown: true },
} as const;

/** 画面に出すルールの短いラベル。 */
export const PICK_RULE_LABELS: Record<PickRule, string> = {
  B: "過去70%×10万以下×75日線下×市場↓",
  C: "過去70%×20万以下×市場↓",
  D: "過去80%(8年)×20万以下",
};

/** 対象にする権利月: 権利付最終日までの営業日数がこの範囲（両端含む）。 */
export const PICK_ENTRY_DAYS_MIN = 30;
export const PICK_ENTRY_DAYS_MAX = 90;

/** 各月に書く件数の上限。 */
export const PICK_LIMIT_PER_MONTH = 15;

/** asOf がこの日数以上前なら「古い」（更新待ち）。 */
export const PICKS_STALE_DAYS = 7;

/** 検証で出た勝率（画面の注記に使う）。 */
export const PICKS_NOTE = { perTradeMax: 0.77, basketB: 0.85, basketC: 0.83, basketD: 0.76 } as const;

/** 候補 1 銘柄。 */
export interface PickItem {
  code: string;
  name: string;
  /** 同時期の過去成績の年数 */
  n: number;
  /** 勝った年数（ret > 0） */
  win: number;
  /** 平均騰落率（比率） */
  avg: number;
  /** 最悪の年の騰落率（比率） */
  worst: number;
  /** 直近の年から数えた連勝数 */
  streak: number;
  /** 直近の終値 */
  price: number;
  /** price の日付（YYYY-MM-DD）。無ければ null */
  priceAsOf: string | null;
  /** 100 株の金額（price × 100） */
  invest: number;
  /** 優待の最低投資金額（円）。無ければ null */
  minInvest: number | null;
  /** 直近の終値が 75 日線より上か。不明なら null */
  aboveMa75: boolean | null;
  /** 直近 1 年の高安レンジの中の位置（0〜1）。不明なら null */
  pos12: number | null;
  /** 直近 1 か月の騰落率（比率） */
  ret1m: number | null;
  sector: string | null;
  nextEarningsDate: string | null;
  /** 大和IR の銘柄詳細ページ。無ければ null */
  detailUrl: string | null;
  /** 該当したルール（B → C → D の順） */
  rules: PickRule[];
}

/** 権利月 1 つぶん。 */
export interface PickMonth {
  /** 権利確定月（1〜12） */
  month: number;
  /** 権利確定月の年 */
  year: number;
  /** 権利付最終日（YYYY-MM-DD） */
  lastCumDate: string;
  /** 今日から権利付最終日までの営業日数（この日数前に買う戦略の成績で数えた） */
  entryDays: number;
  /** ルールのどれかに当てはまった銘柄数（上限で切る前） */
  matched: number;
  items: PickItem[];
}

/** picks.json の中身。 */
export interface PicksFile {
  generatedAt: string;
  /** 作った日（YYYY-MM-DD、JST） */
  asOf: string;
  /** 直近 1 か月の優待銘柄の騰落率の中央値（比率）。無ければ null */
  marketRet1m: number | null;
  /** 市場条件（marketRet1m ≤ 0）が成り立つか */
  marketDown: boolean;
  months: PickMonth[];
  note: { perTradeMax: number; basketB: number; basketC: number; basketD: number };
}

/** picks.json の URL（サイト相対）。 */
export const YUTAI_PICKS_URL = "/data/yutai/picks.json";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** 勝率（win / n）。n が 0 なら 0。 */
export function pickRate(item: Pick<PickItem, "n" | "win">): number {
  return item.n > 0 ? item.win / item.n : 0;
}

/** 銘柄が当てはまるルール（B → C → D の順）。 */
export function ruleMatches(
  item: Pick<PickItem, "n" | "win" | "invest" | "aboveMa75">,
  marketDown: boolean,
): PickRule[] {
  const rate = pickRate(item);
  const out: PickRule[] = [];
  for (const rule of PICK_RULES) {
    const t = PICK_RULE_THRESHOLDS[rule];
    if (item.n < t.minN || rate < t.minRate || !(item.invest > 0) || item.invest > t.maxInvest) continue;
    if (t.needMarketDown && !marketDown) continue;
    if (rule === "B" && item.aboveMa75 !== false) continue;
    out.push(rule);
  }
  return out;
}

/** 並び順: 勝率 降順 → 年数 降順 → 平均 降順。 */
export function comparePicks(a: PickItem, b: PickItem): number {
  return pickRate(b) - pickRate(a) || b.n - a.n || b.avg - a.avg;
}

/** ルールを付け直し、当てはまる銘柄だけを並べ替えて返す。 */
export function selectPicks(items: PickItem[], marketDown: boolean): PickItem[] {
  return items
    .map((it) => ({ ...it, rules: ruleMatches(it, marketDown) }))
    .filter((it) => it.rules.length > 0)
    .sort(comparePicks);
}

/** 中央値（null・NaN を除く）。値が無ければ null。 */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** fromIso より後、toIso 以下の営業日の数（fromIso の翌営業日から数える）。 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  let n = 0;
  for (let d = addDaysIso(fromIso, 1); d <= toIso; d = addDaysIso(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}

/** 今日から見て対象にする権利月（権利付最終日までの営業日数が PICK_ENTRY_DAYS_MIN〜MAX）。近い順。 */
export function targetPickMonths(
  todayIso: string,
  min = PICK_ENTRY_DAYS_MIN,
  max = PICK_ENTRY_DAYS_MAX,
): { month: number; year: number; lastCumDate: string; entryDays: number }[] {
  const out: { month: number; year: number; lastCumDate: string; entryDays: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const s = nextYutaiSchedule(m, todayIso);
    const e = businessDaysBetween(todayIso, s.lastCumDate);
    if (e >= min && e <= max) out.push({ month: m, year: s.year, lastCumDate: s.lastCumDate, entryDays: e });
  }
  return out.sort((a, b) => a.lastCumDate.localeCompare(b.lastCumDate));
}

/** 年ごとの騰落率（古い→新しい）から過去成績をまとめる。年が無ければ null。 */
export function summarizeHistory(rets: { year: number; ret: number }[]): Pick<PickItem, "n" | "win" | "avg" | "worst" | "streak"> | null {
  if (rets.length === 0) return null;
  const sorted = [...rets].sort((a, b) => a.year - b.year);
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].ret > 0; i--) streak++;
  return {
    n: sorted.length,
    win: sorted.filter((r) => r.ret > 0).length,
    avg: sorted.reduce((s, r) => s + r.ret, 0) / sorted.length,
    worst: Math.min(...sorted.map((r) => r.ret)),
    streak,
  };
}

function parseRules(raw: unknown): PickRule[] {
  if (!Array.isArray(raw)) return [];
  return PICK_RULES.filter((r) => raw.includes(r));
}

function parseItem(raw: unknown): PickItem | null {
  if (!isRecord(raw)) return null;
  const { code, name } = raw;
  const n = num(raw.n);
  const win = num(raw.win);
  const avg = num(raw.avg);
  const worst = num(raw.worst);
  const price = num(raw.price);
  if (typeof code !== "string" || code === "" || typeof name !== "string") return null;
  if (n === null || n < 1 || win === null || win < 0 || win > n || avg === null || worst === null) return null;
  if (price === null || price <= 0) return null;
  const rules = parseRules(raw.rules);
  if (rules.length === 0) return null;
  const invest = num(raw.invest);
  const above = raw.aboveMa75;
  const priceAsOf = strOrNull(raw.priceAsOf);
  const earnings = strOrNull(raw.nextEarningsDate);
  return {
    code,
    name,
    n: Math.round(n),
    win: Math.round(win),
    avg,
    worst,
    streak: Math.max(0, Math.round(num(raw.streak) ?? 0)),
    price,
    priceAsOf: priceAsOf && ISO_DATE.test(priceAsOf) ? priceAsOf : null,
    invest: invest !== null && invest > 0 ? invest : price * 100,
    minInvest: num(raw.minInvest),
    aboveMa75: typeof above === "boolean" ? above : null,
    pos12: num(raw.pos12),
    ret1m: num(raw.ret1m),
    sector: strOrNull(raw.sector),
    nextEarningsDate: earnings && ISO_DATE.test(earnings) ? earnings : null,
    detailUrl: typeof raw.detailUrl === "string" && /^https?:\/\//.test(raw.detailUrl) ? raw.detailUrl : null,
    rules,
  };
}

function parseMonth(raw: unknown): PickMonth | null {
  if (!isRecord(raw)) return null;
  const month = num(raw.month);
  const year = num(raw.year);
  const entryDays = num(raw.entryDays);
  const lastCumDate = raw.lastCumDate;
  if (month === null || month < 1 || month > 12 || entryDays === null) return null;
  if (typeof lastCumDate !== "string" || !ISO_DATE.test(lastCumDate)) return null;
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem).filter((x): x is PickItem => x !== null) : [];
  const matched = num(raw.matched);
  return {
    month: Math.round(month),
    year: year !== null ? Math.round(year) : Number(lastCumDate.slice(0, 4)),
    lastCumDate,
    entryDays: Math.round(entryDays),
    matched: matched !== null && matched >= items.length ? Math.round(matched) : items.length,
    items,
  };
}

/** picks.json（unknown）を検証して型付きにする。asOf が日付でなければ null。形の崩れた行・月は落とす。 */
export function parsePicksFile(raw: unknown): PicksFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  const months = Array.isArray(raw.months)
    ? raw.months.map(parseMonth).filter((x): x is PickMonth => x !== null)
    : [];
  const marketRet1m = num(raw.marketRet1m);
  const note = isRecord(raw.note) ? raw.note : {};
  return {
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    asOf,
    marketRet1m,
    marketDown: typeof raw.marketDown === "boolean" ? raw.marketDown : marketRet1m !== null && marketRet1m <= 0,
    months,
    note: {
      perTradeMax: num(note.perTradeMax) ?? PICKS_NOTE.perTradeMax,
      basketB: num(note.basketB) ?? PICKS_NOTE.basketB,
      basketC: num(note.basketC) ?? PICKS_NOTE.basketC,
      basketD: num(note.basketD) ?? PICKS_NOTE.basketD,
    },
  };
}

/** asOf が todayIso から PICKS_STALE_DAYS 日以上前か。 */
export function isPicksStale(asOf: string, todayIso: string, staleDays = PICKS_STALE_DAYS): boolean {
  if (!ISO_DATE.test(asOf) || !ISO_DATE.test(todayIso)) return true;
  return daysBetween(asOf, todayIso) >= staleDays;
}
