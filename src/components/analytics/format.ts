import type { MetricKey } from "@/lib/analytics";

export function signed(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/** 指標値の表示。null は「—」。 */
export function formatMetric(key: MetricKey, v: number | null): string {
  if (v === null) return "—";
  switch (key) {
    case "count":
      return `${v} 社`;
    case "avgReturn":
      return `${signed(v)}%`;
    default:
      return `${v.toFixed(0)}%`;
  }
}

/** 前期間比の表示（件数は社、率は pt）。 */
export function formatDelta(key: MetricKey, d: number): string {
  const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "→";
  const abs = Math.abs(d);
  if (key === "count") return `${arrow} ${abs} 社`;
  return `${arrow} ${abs.toFixed(1)}pt`;
}

/** 増加が良い向きか（公募割れ率は減少が良い）。 */
export function deltaTone(key: MetricKey, d: number): "up" | "down" | "flat" {
  if (d === 0) return "flat";
  const good = key === "breakRate" ? d < 0 : d > 0;
  return good ? "up" : "down";
}
