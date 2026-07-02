import type { Ipo, IpoStatus } from "@/types/ipo";

// 表示用のフォーマットヘルパ。

export const STATUS_LABELS: Record<IpoStatus, string> = {
  upcoming: "上場予定",
  bb_open: "BB受付中",
  priced: "公開価格決定",
  listed: "上場済",
};

export const STATUS_BADGE_CLASS: Record<IpoStatus, string> = {
  upcoming: "bg-slate-100 text-slate-700",
  bb_open: "bg-amber-100 text-amber-800",
  priced: "bg-blue-100 text-blue-800",
  listed: "bg-emerald-100 text-emerald-800",
};

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${y}/${m}/${d}`;
}

export function formatYen(value: number | null): string {
  if (value === null) return "未定";
  return `${value.toLocaleString()}円`;
}

export function formatOku(value: number): string {
  return `${value.toLocaleString()}億円`;
}

/** 想定資金拘束目安（1単元=100株）。公開価格未定なら仮条件上限を使う。 */
export function estimatedLockAmount(ipo: Ipo): number {
  const price = ipo.offeringPrice ?? ipo.priceRange.high;
  return price * 100;
}

/** 初値騰落率（%）。初値または公開価格が無ければ null。 */
export function initialReturnRate(ipo: Ipo): number | null {
  if (ipo.initialPrice === null || ipo.offeringPrice === null) return null;
  return ((ipo.initialPrice - ipo.offeringPrice) / ipo.offeringPrice) * 100;
}
