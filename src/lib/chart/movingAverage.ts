// 単純移動平均（SMA）。チャート描画用の純関数。

/**
 * closes（古い→新しい順）の window 日単純移動平均を返す。
 * 戻り値は closes と同じ長さで、window 件そろわない先頭区間は null。
 * window が1未満・非整数の場合は全要素 null。
 */
export function computeMovingAverage(
  closes: number[],
  window: number,
): (number | null)[] {
  if (!Number.isInteger(window) || window < 1) {
    return closes.map(() => null);
  }
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= window) sum -= closes[i - window];
    result.push(i >= window - 1 ? sum / window : null);
  }
  return result;
}
