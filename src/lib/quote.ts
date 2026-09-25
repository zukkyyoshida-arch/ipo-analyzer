// quote API（/api/quote/[code]）のレスポンス型とクライアント用フェッチヘルパー。
// API 本体（route.ts）は別担当が実装する。ここは型と fetch のみを共有する。

export interface QuotePoint {
  /** ISO 日付 (YYYY-MM-DD) */
  date: string;
  close: number;
  /** 出来高（株）。取得できない日は null */
  volume: number | null;
}

export interface QuoteResponse {
  code: string;
  /** 現在値（円） */
  price: number;
  /** 前日終値（円）。データが1日分しか無い場合は null */
  prevClose: number | null;
  /** 前日比（%）。prevClose が無い場合は null */
  changePct: number | null;
  /** 直近90日分の終値・出来高（日付昇順） */
  closes: QuotePoint[];
  /** 取得時刻（ISO） */
  updatedAt: string;
}

/**
 * /api/quote/[code] からライブ値を取得する。
 * 取得失敗（ネットワークエラー・404・JSON不正・中断）時は null を返す。
 */
export async function fetchQuote(
  code: string,
  signal?: AbortSignal,
): Promise<QuoteResponse | null> {
  try {
    const res = await fetch(`/api/quote/${code}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as QuoteResponse;
  } catch {
    // AbortError を含め、失敗時は null（呼び出し側は静的値にフォールバック）。
    return null;
  }
}
