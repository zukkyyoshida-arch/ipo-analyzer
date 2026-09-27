/** 日足 1 本分（初値判定に使う項目だけ）。 */
export interface DailyQuote {
  open: number | null;
  volume: number | null;
}

/**
 * 上場日以降の日足から「初値の足」を選ぶ。
 *
 * Yahoo の日足には出来高 0 の穴埋め行が混ざることがあり（例: 8303 の上場日に
 * open=55,319,998,464・volume=0 の行）、先頭行をそのまま初値にすると騰落率が
 * 数千万 % に化ける。出来高と始値が正の最初の足を初値として扱う。
 */
export function pickInitialQuote<T extends DailyQuote>(quotes: T[]): T | undefined {
  return quotes.find((q) => (q.volume ?? 0) > 0 && (q.open ?? 0) > 0);
}

/** 初値・上場日出来高を取り直す必要があるか（未取得、または穴埋め行を拾った出来高 0）。 */
export function needsInitialRefetch(record: {
  initialPrice?: number | null;
  initialVolume?: number | null;
}): boolean {
  return (
    typeof record.initialPrice !== "number" ||
    typeof record.initialVolume !== "number" ||
    record.initialVolume === 0
  );
}
