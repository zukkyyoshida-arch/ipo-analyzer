import YahooFinance from "yahoo-finance2";
import { TICKERS, PRICE_LOOKBACK_DAYS } from "./config";

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
