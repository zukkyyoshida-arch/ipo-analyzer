import type { Ipo } from "@/types/ipo";
import { addDaysIso, daysBetween } from "@/lib/date";

// 初値決定・即金規制の通知に使う純関数（対象の選定・日足からの初値検知・KV 状態の読み書き）。
// 送信と quote 取得は worker/run-push-notifications.ts が行う。

/** 初値が付かずに持ち越した銘柄を、上場日から何暦日まで監視するか（週末をまたいでも 2〜3 営業日を拾える幅）。 */
export const INITIAL_PRICE_CARRY_DAYS = 4;
/** KV 状態に残す日数（これより古い記録は捨てる）。 */
const STATE_RETENTION_DAYS = 14;

/** /api/quote の closes の必要部分（日足 1 本）。 */
export interface DailyBar {
  date: string;
  open: number | null;
  close: number;
  volume: number | null;
}

/**
 * 初値・即金規制の送信状態（KV の `state:initial-price` に JSON で置く）。
 * - formed: 初値の成立を検知した銘柄（検知日と初値）。初値決定の通知はここに無い銘柄にだけ送る。
 * - instantCash: 即金規制の可能性を送った銘柄（判定日）。
 */
export interface InitialPriceState {
  formed: Record<string, { date: string; price: number }>;
  instantCash: Record<string, string>;
}

export function emptyInitialPriceState(): InitialPriceState {
  return { formed: {}, instantCash: {} };
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** KV から読んだ値を検証する。壊れていれば空の状態。 */
export function parseInitialPriceState(raw: unknown): InitialPriceState {
  const state = emptyInitialPriceState();
  if (typeof raw !== "object" || raw === null) return state;
  const r = raw as Record<string, unknown>;
  if (typeof r.formed === "object" && r.formed !== null) {
    for (const [code, v] of Object.entries(r.formed as Record<string, unknown>)) {
      const e = v as { date?: unknown; price?: unknown } | null;
      if (e && isIsoDate(e.date) && isPositive(e.price)) state.formed[code] = { date: e.date, price: e.price };
    }
  }
  if (typeof r.instantCash === "object" && r.instantCash !== null) {
    for (const [code, date] of Object.entries(r.instantCash as Record<string, unknown>)) {
      if (isIsoDate(date)) state.instantCash[code] = date;
    }
  }
  return state;
}

/** 保持期間を過ぎた記録を捨てた状態（元は変更しない）。 */
export function pruneInitialPriceState(state: InitialPriceState, todayIso: string): InitialPriceState {
  const keep = (date: string) => {
    const age = daysBetween(date, todayIso);
    return Number.isFinite(age) && age <= STATE_RETENTION_DAYS;
  };
  return {
    formed: Object.fromEntries(Object.entries(state.formed).filter(([, v]) => keep(v.date))),
    instantCash: Object.fromEntries(Object.entries(state.instantCash).filter(([, d]) => keep(d))),
  };
}

function hasInitialPrice(ipo: Pick<Ipo, "initialPrice">): boolean {
  return isPositive(ipo.initialPrice);
}

/**
 * 初値決定の監視対象。上場日が [today − INITIAL_PRICE_CARRY_DAYS, today] で、データ上まだ初値が無く、
 * 状態にも成立記録が無い銘柄。通常は当日上場の銘柄だけ（0〜3 件）。
 */
export function initialPriceWatchTargets(
  ipos: readonly Ipo[],
  todayIso: string,
  state: InitialPriceState,
): Ipo[] {
  return ipos
    .filter((ipo) => {
      if (!isIsoDate(ipo.listingDate) || hasInitialPrice(ipo) || state.formed[ipo.code]) return false;
      const since = daysBetween(ipo.listingDate, todayIso);
      return Number.isFinite(since) && since >= 0 && since <= INITIAL_PRICE_CARRY_DAYS;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** 即金規制の判定対象。当日上場で、データ上も状態上も初値が無く、まだ送っていない銘柄。 */
export function instantCashTargets(
  ipos: readonly Ipo[],
  todayIso: string,
  state: InitialPriceState,
): Ipo[] {
  return ipos
    .filter(
      (ipo) =>
        ipo.listingDate === todayIso &&
        !hasInitialPrice(ipo) &&
        !state.formed[ipo.code] &&
        !state.instantCash[ipo.code],
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * 日足から初値（最初に売買が成立した日の始値）を探す。上場日の前日以降の足だけを見る
 * （コードの再利用で過去の別銘柄の足が混ざるのを避ける。前日は日付のずれの吸収用）。
 * 特別気配のまま売買が無い日は出来高 0 の足になるので飛ばす。見つからなければ null。
 */
export function detectInitialPrice(
  bars: readonly DailyBar[],
  listingDate: string,
): { date: string; price: number } | null {
  const from = addDaysIso(listingDate, -1);
  for (const bar of bars) {
    if (!isIsoDate(bar.date) || bar.date < from) continue;
    if (bar.volume !== null && bar.volume <= 0) continue;
    if (!isPositive(bar.open)) continue;
    return { date: bar.date, price: bar.open };
  }
  return null;
}
