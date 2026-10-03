// J-Quants 財務サマリの生行 → fins.json の中身。純関数（I/O は scripts/updater/fins.ts）。
// 進捗率の定義は scratch/backtest/progress_rate.py と同じ:
//   進捗率 = 累計の四半期 OP ÷ 最新の通期予想 FOP。開示値が単独なら同一年度の過去四半期を足して累計にする。

import { daysBetween } from "../date";
import type {
  FinsFile,
  FinsFy,
  FinsItem,
  FinsLatestQuarter,
  FinsQuarterType,
  FinsRawRow,
} from "../../types/fins";

/** 古いとみなす日数（無料枠の遅延は約 84 日。四半期 1 回ぶんの余裕を足して 120 日）。 */
export const FINS_STALE_DAYS = 120;

const QUARTERS: readonly FinsQuarterType[] = ["1Q", "2Q", "3Q"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 数値化。空・null・非数は null。 */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 5 桁コード（末尾 0）を 4 桁に。 */
export function normalizeCode(code: unknown): string {
  const c = String(code ?? "").trim();
  return c.length === 5 && c.endsWith("0") ? c.slice(0, 4) : c;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 開示順（日付・時刻）。同順位は入力順（安定ソート）。 */
function discKey(r: FinsRawRow): string {
  return `${r.DiscDate ?? ""} ${r.DiscTime ?? ""}`;
}

function periodMonth(iso: string | null | undefined): string | null {
  return iso && ISO_DATE.test(iso) ? iso.slice(0, 7) : null;
}

/** 通期予想が属する期末。FY 行の予想は翌期のもの。 */
function forecastFyEnd(r: FinsRawRow): string | null {
  const cur = r.CurFYEn && ISO_DATE.test(r.CurFYEn) ? r.CurFYEn : null;
  if (r.CurPerType !== "FY") return cur;
  if (r.NxtFYEn && ISO_DATE.test(r.NxtFYEn)) return r.NxtFYEn;
  if (!cur) return null;
  return `${Number(cur.slice(0, 4)) + 1}${cur.slice(4)}`;
}

function hasValues(r: FinsRawRow): boolean {
  return toNum(r.Sales) !== null || toNum(r.OP) !== null;
}

/** 1 銘柄ぶんの行（開示順）から FinsItem を作る。何も作れなければ null。 */
export function buildFinsItem(code: string, rows: readonly FinsRawRow[]): FinsItem | null {
  // 通期（FY）: 値のある行を決算期末ごとに最新の開示で 1 本にし、期末の新しい順に並べる
  const fyByEnd = new Map<string, FinsRawRow>();
  for (const r of rows) {
    if (r.CurPerType !== "FY" || !hasValues(r) || !r.CurPerEn) continue;
    fyByEnd.set(r.CurPerEn, r); // 開示順に並んでいるので後勝ち
  }
  const fyEnds = [...fyByEnd.keys()].sort().reverse();
  const toFy = (end: string): FinsFy | null => {
    const r = fyByEnd.get(end);
    const period = periodMonth(end);
    if (!r || !period) return null;
    const eq = toNum(r.EqAR);
    return {
      period,
      sales: toNum(r.Sales),
      op: toNum(r.OP),
      np: toNum(r.NP),
      eqAR: eq === null ? null : round1(eq * 100),
      cfo: toNum(r.CFO),
      sharesOutstanding: toNum(r.ShOutFY),
      discDate: r.DiscDate,
    };
  };
  const fy = fyEnds[0] ? toFy(fyEnds[0]) : null;
  const prevEnd = fyEnds[1];
  const prevFy = prevEnd
    ? (() => {
        const r = fyByEnd.get(prevEnd)!;
        const period = periodMonth(prevEnd);
        return period ? { period, sales: toNum(r.Sales), op: toNum(r.OP) } : null;
      })()
    : null;

  // 通期予想: 期末ごとに最新の開示（予想修正のみの行も含む）
  const forecastByEnd = new Map<string, FinsRawRow>();
  for (const r of rows) {
    if (toNum(r.FOP) === null && toNum(r.FSales) === null) continue;
    const end = forecastFyEnd(r);
    if (end) forecastByEnd.set(end, r);
  }
  const forecastEnds = [...forecastByEnd.keys()].sort().reverse();
  const forecastRow = forecastEnds[0] ? forecastByEnd.get(forecastEnds[0]) : undefined;
  const forecast =
    forecastRow && forecastEnds[0] && periodMonth(forecastEnds[0])
      ? {
          period: periodMonth(forecastEnds[0])!,
          sales: toNum(forecastRow.FSales),
          op: toNum(forecastRow.FOP),
          np: toNum(forecastRow.FNP),
          discDate: forecastRow.DiscDate,
        }
      : null;

  // 最新の四半期: 値のある 1Q〜3Q の最後の開示。その期の通期決算が出ていれば対象外
  let latest: FinsRawRow | null = null;
  for (const r of rows) {
    if (!(QUARTERS as readonly string[]).includes(r.CurPerType ?? "") || !hasValues(r)) continue;
    latest = r;
  }
  let latestQuarter: FinsLatestQuarter | null = null;
  if (latest && latest.CurFYEn && latest.CurPerEn) {
    const fyEnd = latest.CurFYEn;
    const closed = fyByEnd.has(fyEnd) || (fyEnds[0] !== undefined && fyEnds[0] >= fyEnd);
    if (!closed) {
      const type = latest.CurPerType as FinsQuarterType;
      // 同一年度の各四半期の最新の開示
      const qByType = new Map<string, FinsRawRow>();
      for (const r of rows) {
        if (r.CurFYEn === fyEnd && (QUARTERS as readonly string[]).includes(r.CurPerType ?? "") && hasValues(r)) {
          qByType.set(r.CurPerType as string, r);
        }
      }
      const q1 = toNum(qByType.get("1Q")?.OP);
      const q2 = toNum(qByType.get("2Q")?.OP);
      const cumulative = q1 !== null && q2 !== null ? q2 > q1 : null;
      let sales = toNum(latest.Sales);
      let op = toNum(latest.OP);
      if (cumulative === false) {
        for (const t of QUARTERS) {
          if (t >= type) break;
          const r = qByType.get(t);
          if (!r) continue;
          const s = toNum(r.Sales);
          const o = toNum(r.OP);
          if (sales !== null && s !== null) sales += s;
          if (op !== null && o !== null) op += o;
        }
      }
      const f = forecastByEnd.get(fyEnd);
      const fop = toNum(f?.FOP);
      const fsales = toNum(f?.FSales);
      latestQuarter = {
        type,
        periodEnd: latest.CurPerEn,
        sales,
        op,
        discDate: latest.DiscDate,
        progressOpPct: op !== null && fop !== null && fop > 0 ? round1((op / fop) * 100) : null,
        progressSalesPct:
          sales !== null && fsales !== null && fsales > 0 ? round1((sales / fsales) * 100) : null,
        cumulative,
      };
    }
  }

  if (!fy && !forecast && !latestQuarter) return null;
  return { code, fy, prevFy, forecast, latestQuarter };
}

/** 生行（順不同・全銘柄）→ fins.json。targetCodes に無い銘柄は含めない。asOf は全行の最新の開示日。 */
export function buildFinsFile(
  rows: readonly FinsRawRow[],
  targetCodes: ReadonlySet<string>,
  generatedAt: string,
): FinsFile {
  let asOf = "";
  const byCode = new Map<string, FinsRawRow[]>();
  for (const r of rows) {
    if (!r || typeof r.DiscDate !== "string") continue;
    if (r.DiscDate > asOf) asOf = r.DiscDate;
    const code = normalizeCode(r.Code);
    if (!targetCodes.has(code)) continue;
    const list = byCode.get(code);
    if (list) list.push(r);
    else byCode.set(code, [r]);
  }
  const items: Record<string, FinsItem> = {};
  for (const code of [...byCode.keys()].sort()) {
    const list = byCode.get(code)!;
    list.sort((a, b) => (discKey(a) < discKey(b) ? -1 : discKey(a) > discKey(b) ? 1 : 0));
    const item = buildFinsItem(code, list);
    if (item) items[code] = item;
  }
  return { generatedAt, asOf, source: "J-Quants", delayNote: "無料枠は約12週遅延", items };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 読み込んだ JSON を FinsFile として検証。壊れていれば null。中身は形だけ確かめる。 */
export function parseFinsFile(raw: unknown): FinsFile | null {
  if (!isRecord(raw)) return null;
  const asOf = raw.asOf;
  if (typeof asOf !== "string" || !ISO_DATE.test(asOf)) return null;
  if (!isRecord(raw.items)) return null;
  const items: Record<string, FinsItem> = {};
  for (const [code, v] of Object.entries(raw.items)) {
    if (!isRecord(v) || v.code !== code) continue;
    items[code] = v as unknown as FinsItem;
  }
  return {
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    asOf,
    source: "J-Quants",
    delayNote: "無料枠は約12週遅延",
    items,
  };
}

/** asOf が today から 120 日超前なら true（更新が止まっている）。 */
export function isFinsStale(asOf: string, todayIso: string): boolean {
  return daysBetween(asOf, todayIso) > FINS_STALE_DAYS;
}
