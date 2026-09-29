import YahooFinance from "yahoo-finance2";
import { TICKERS, PRICE_LOOKBACK_DAYS } from "./config";
import type { SplitEvent } from "./split";

// yahoo-finance2（非公式 API）を使った価格・指数の取得。
// 個人利用の範囲で使うこと。障害時は例外を投げ、呼び出し側で握って既存データを維持する。

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/** 指数/ETF の直近終値配列（古い→新しい順）を返す。 */
export async function fetchDailyCloses(
  ticker: string,
  lookbackDays = PRICE_LOOKBACK_DAYS,
): Promise<number[]> {
  const period2 = new Date();
  const period1 = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  const chart = await yf.chart(ticker, {
    period1,
    period2,
    interval: "1d",
  });
  return chart.quotes
    .map((q) => q.close)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
}

/** 個別銘柄の現在値（regularMarketPrice）を取得。取得不能なら null。 */
export async function fetchCurrentPrice(
  ticker: string,
): Promise<number | null> {
  try {
    const q = await yf.quote(ticker);
    const p = q.regularMarketPrice;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

/** 日本株コードを Yahoo ティッカーへ（例: "323A" → "323A.T"）。 */
export function toYahooTicker(code: string): string {
  return `${code}.T`;
}

export interface IndexCloses {
  nikkei: number[];
  growth250: number[];
}

/** 日経平均とグロース250の終値配列をまとめて取得。 */
export async function fetchIndexCloses(): Promise<IndexCloses> {
  const [nikkei, growth250] = await Promise.all([
    fetchDailyCloses(TICKERS.nikkei),
    fetchDailyCloses(TICKERS.growth250),
  ]);
  return { nikkei, growth250 };
}

/** 個別銘柄の日足1本分（初値・出来高の判定に使う項目）。値は Yahoo の分割調整済み。 */
export interface ChartQuote {
  date: Date;
  open: number | null;
  close: number | null;
  volume: number | null;
}

/**
 * 上場日の数日前〜今日の日足（分割調整済み）と、その期間の株式分割イベントを取得する。
 * fetchDailyCloses は終値のみを返す設計だが、ここでは初値(open)・出来高(volume)・分割も要る。
 * 分割イベントは chart() の events: "split" で events.splits（date・numerator・denominator）に入る。
 */
export async function fetchChartSinceListing(
  ticker: string,
  listingDate: string,
): Promise<{ quotes: ChartQuote[]; splits: SplitEvent[] }> {
  const listingDateObj = new Date(`${listingDate}T00:00:00+09:00`);
  const lookbackDays = Math.max(
    1,
    Math.ceil((Date.now() - listingDateObj.getTime()) / (24 * 3600 * 1000)) + 3,
  );
  const period2 = new Date();
  const period1 = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  const chart = await yf.chart(ticker, { period1, period2, interval: "1d", events: "split" });
  const quotes = chart.quotes
    .filter((q) => q.open !== null || q.close !== null || q.volume !== null)
    .map((q) => ({ date: q.date, open: q.open, close: q.close, volume: q.volume }));
  const splits = (chart.events?.splits ?? []).map((s) => ({
    date: s.date,
    numerator: s.numerator,
    denominator: s.denominator,
  }));
  return { quotes, splits };
}
