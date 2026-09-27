/**
 * 騰落率(%)を色付きで表示する。値が無い場合は「—」を表示する。
 * @param value 騰落率(%)。null可
 * @param decimals 小数点以下桁数（既定 1）
 * @param className 追加クラス
 */
export function PriceChange({
  value,
  decimals = 1,
  className = "",
}: {
  value: number | null;
  decimals?: number;
  className?: string;
}) {
  if (value === null) {
    return <span className={`text-muted ${className}`}>—</span>;
  }
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`font-medium ${tone} ${className}`}>
      {sign}
      {value.toFixed(decimals)}%
    </span>
  );
}
