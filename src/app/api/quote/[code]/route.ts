import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

// 銘柄コードのライブ株価取得API（詳細ページのスパークライン用）。
// scripts/updater/prices.ts と同じ yahoo-finance2 の使い方（chart()）を踏襲する。

export const revalidate = 600;

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const CODE_PATTERN = /^[0-9A-Z]{4}$/;
const LOOKBACK_DAYS = 120;

interface QuoteClose {
  date: string;
  close: number;
  volume: number | null;
}

interface QuoteResponse {
  code: string;
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
  closes: QuoteClose[];
  updatedAt: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  if (!CODE_PATTERN.test(code)) {
    return NextResponse.json({ error: "invalid code" }, { status: 400 });
  }

  const ticker = `${code}.T`;

  try {
    const period2 = new Date();
    const period1 = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
    const chart = await yf.chart(ticker, {
      period1,
      period2,
      interval: "1d",
    });

    const closes: QuoteClose[] = chart.quotes
      .filter(
        (q): q is typeof q & { close: number } =>
          typeof q.close === "number" && Number.isFinite(q.close),
      )
      .map((q) => ({
        date:
          q.date instanceof Date
            ? q.date.toISOString().slice(0, 10)
            : String(q.date),
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
