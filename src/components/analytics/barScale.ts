// 縦棒グラフ（BarChart）の目盛り・棒の位置・X ラベル位置を計算する純関数。描画は BarChart.tsx。

const NICE_STEPS = [1, 2, 5, 10];

/** これより絶対値が小さい値は 0 とみなす（浮動小数の誤差で 1e-15 などが出ても、目盛りや棒を壊さないため）。 */
export const ZERO_EPSILON = 1e-6;

/**
 * 描画・軸計算に使う値のそろえ方。null・非有限（NaN / Infinity）は null（値なし）、
 * 絶対値が ZERO_EPSILON 未満は 0、それ以外はそのまま返す。
 */
export function cleanValue(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.abs(v) < ZERO_EPSILON ? 0 : v;
}

/**
 * min〜max を覆う、きりの良い目盛り（最大 maxTicks 本、両端を含む）。
 * integer なら刻みを 1 以上の整数にする（件数の軸に 0.5 などを出さない）。
 */
export function niceTicks(
  min: number,
  max: number,
  { integer = false, maxTicks = 5 }: { integer?: boolean; maxTicks?: number } = {},
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo0 = Math.min(cleanValue(min) ?? 0, cleanValue(max) ?? 0);
  let hi0 = Math.max(cleanValue(min) ?? 0, cleanValue(max) ?? 0);
  if (lo0 === hi0) {
    if (lo0 === 0) hi0 = 1;
    else if (lo0 > 0) lo0 = 0;
    else hi0 = 0;
  }
  const raw = (hi0 - lo0) / Math.max(1, maxTicks - 1);
  let mag = 10 ** Math.floor(Math.log10(raw));
  let idx = NICE_STEPS.findIndex((n) => n * mag >= raw * (1 - 1e-9));
  if (idx < 0) idx = NICE_STEPS.length - 1;

  for (let guard = 0; guard < 40; guard++) {
    let step = NICE_STEPS[idx] * mag;
    if (integer) step = Math.max(1, Math.round(step));
    const lo = Math.floor(lo0 / step + 1e-9) * step;
    const hi = Math.ceil(hi0 / step - 1e-9) * step;
    const count = Math.round((hi - lo) / step) + 1;
    if (count <= maxTicks) {
      const out: number[] = [];
      // 浮動小数の誤差だけを丸める（桁数は固定せず有効数字 12 桁）。toFixed(6) だと 1e-7 級の刻みが全部 0 に潰れる
      for (let k = 0; k < count; k++) out.push(Number((lo + k * step).toPrecision(12)) + 0);
      // 目盛りは 2 本以上・重複なし（React の key と縦位置が衝突しないように）。崩れたら両端だけにする
      return new Set(out).size >= 2 ? out : [lo0, hi0];
    }
    idx += 1;
    if (idx >= NICE_STEPS.length) {
      idx = 1;
      mag *= 10;
    }
  }
  return [lo0, hi0];
}

/** 棒グラフの縦軸の範囲。棒は必ず 0 から伸ばすので、範囲は常に 0 を含む。値が無ければ null。 */
export function barDomain(
  values: (number | null)[],
  opts: { integer?: boolean } = {},
): { ticks: number[]; min: number; max: number } | null {
  const vs = values.map(cleanValue).filter((v): v is number => v !== null);
  if (vs.length === 0) return null;
  const ticks = niceTicks(Math.min(0, ...vs), Math.max(0, ...vs), opts);
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1] };
}

/** 値 v の縦位置（プロット上端からの %）。 */
export function yPercent(v: number, min: number, max: number): number {
  const span = max - min || 1;
  return ((max - v) / span) * 100;
}

/**
 * 1 本の棒の位置（プロット高さに対する %）。0 の基準線から値まで伸ばす。
 * baseline は基準線の上端からの位置、length は棒の長さ、negative はマイナス（下向き）か。
 */
export function barExtent(
  v: number,
  min: number,
  max: number,
): { baseline: number; length: number; negative: boolean } {
  const baseline = yPercent(0, min, max);
  const end = yPercent(v, min, max);
  return { baseline, length: Math.abs(end - baseline), negative: v < 0 };
}

/**
 * X 軸ラベルを出す棒の添字。最新（右端）を必ず含め、そこから等間隔に左へ間引く。
 * 本数が maxLabels 以下なら全部出す。
 */
export function labelIndices(n: number, maxLabels = 4): number[] {
  if (n <= 0) return [];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / maxLabels);
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}
