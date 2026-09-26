import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

// 銘柄コードのライブ株価取得API（詳細ページのスパークライン・ローソク足用）。
// scripts/updater/prices.ts と同じ yahoo-finance2 の使い方（chart()）を踏襲する。
// ?days=N で取得期間（暦日）を指定できる（未指定 120、1〜365 にクランプ）。

export const revalidate = 600;

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const CODE_PATTERN = /^[0-9A-Z]{4}$/;
const DEFAULT_LOOKBACK_DAYS = 120;
const MAX_LOOKBACK_DAYS = 365;

export interface QuoteClosePoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface QuoteResponse {
  code: string;
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  closes: QuoteClosePoint[];
  updatedAt: string;
}

/** ?days= を 1〜365 の整数に丸める。未指定・不正値は既定 120。 */
function parseLookbackDays(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_LOOKBACK_DAYS;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(1, n));
}

/** 有限数なら値、そうでなければ null。 */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  if (!CODE_PATTERN.test(code)) {
    return NextResponse.json({ error: "invalid code" }, { status: 400 });
  }

  const ticker = `${code}.T`;
  const lookbackDays = parseLookbackDays(
    new URL(request.url).searchParams.get("days"),
  );

  try {
    const period2 = new Date();
    const period1 = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
    const chart = await yf.chart(ticker, {
      period1,
      period2,
      interval: "1d",
    });

    const closes: QuoteClosePoint[] = chart.quotes
      .filter(
        (q): q is typeof q & { close: number } =>
          typeof q.close === "number" && Number.isFinite(q.close),
      )
      .map((q) => ({
        date:
          q.date instanceof Date
            ? q.date.toISOString().slice(0, 10)
            : String(q.date),
        open: finiteOrNull(q.open),
        high: finiteOrNull(q.high),
        low: finiteOrNull(q.low),
        close: q.close,
        volume: typeof q.volume === "number" ? q.volume : null,
      }));

    if (closes.length === 0) {
      return NextResponse.json({ error: "no data" }, { status: 404 });
    }

    const price = closes[closes.length - 1].close;
    const prevClose =
      closes.length >= 2 ? closes[closes.length - 2].close : null;
    const changePct =
      prevClose !== null && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : null;

    const body: QuoteResponse = {
      code,
      price,
      prevClose,
      changePct,
      closes,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 404 });
  }
}
