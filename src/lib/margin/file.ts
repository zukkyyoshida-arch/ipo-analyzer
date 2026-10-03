// 信用取引残高（margin.json）の生成・検証。純関数。
// 入力は JPX「銘柄別信用取引残高」PDF を行ごとのセル配列にしたもの（PDF → 行の変換は scripts/updater/margin.ts）。
//
// 出典の事情（2026-10-03 調査）: JPX は 2026 年 9 月に公表を改め、旧「銘柄別信用取引週末残高」（週次・Excel）を
// 「銘柄別信用取引残高」（毎営業日 16:00 ごろ・PDF のみ・株数と金額）に置き換えた。銘柄別の Excel は現在無い。
// PDF の各銘柄は 2 行（「株数 Shs.」行と「金額 Val.」行）で、株数の行に
// [売残合計, 前日比, 上場比, 買残合計, 前日比, 上場比, 売(一般), 前日比, 売(制度), 前日比, 買(一般), ...] が並ぶ。
// 列名ではなく「株数 Shs.」の目印の後ろの並び順で読む（JPX の様式が変われば parse が 0 件になり、更新は見送られる）。

import { daysBetween } from "../date";
import type { MarginFile, MarginItem } from "../../types/margin";

/** 基準日からこの日数を超えたら古いデータ扱い。 */
export const MARGIN_STALE_DAYS = 14;

const SHARES_MARK = "株数 Shs.";

/** "1,234" / "▲ 200" / "▲200" / "-" / "*" → 数値（読めなければ null）。▲ は減少（負）。 */
export function parseSignedNumber(raw: string): number | null {
  const s = raw.replace(/\s+/g, "").replace(/,/g, "");
  if (s === "" || s === "-" || s === "*") return null;
  const neg = s.startsWith("▲");
  const body = neg ? s.slice(1) : s;
  if (!/^\d+$/.test(body)) return null;
  const n = Number(body);
  return neg ? -n : n;
}

/** 5 桁の証券コード（末尾 0）を 4 桁にそろえる。130A0 → 130A、13010 → 1301。それ以外は null。 */
export function normalizeCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (/^[0-9]{3}[0-9A-Z]0$/.test(s)) return s.slice(0, 4);
  if (/^[0-9]{3}[0-9A-Z]$/.test(s)) return s;
  return null;
}

/** 「2026/10/1 申込み現在」のようなセルから基準日（YYYY-MM-DD）を探す。 */
export function findAsOf(rows: readonly (readonly string[])[]): string | null {
  for (const row of rows) {
    for (const cell of row) {
      const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*申込み?現在/.exec(cell);
      if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
  }
  return null;
}

/** 行（セル配列）が株数の行なら、コードと残高を返す。 */
function parseSharesRow(row: readonly string[]): { code: string; item: MarginItem } | null {
  const mark = row.findIndex((c) => c.includes(SHARES_MARK));
  if (mark < 0) return null;
  // コードは目印のセルかその手前にある 5 桁（末尾 0）。
  let code: string | null = null;
  for (let i = mark; i >= 0 && code === null; i--) {
    for (const t of row[i].split(/\s+/)) {
      if (/^[0-9]{3}[0-9A-Z]0$/.test(t)) code = normalizeCode(t);
    }
  }
  if (!code) return null;
  const nums = row.slice(mark + 1).filter((c) => c.trim() !== "");
  if (nums.length < 5) return null;
  const sell = parseSignedNumber(nums[0]);
  const sellDaily = parseSignedNumber(nums[1]);
  const buy = parseSignedNumber(nums[3]);
  const buyDaily = parseSignedNumber(nums[4]);
  if (sell === null || buy === null) return null;
  return {
    code,
    item: {
      buy,
      sell,
      buyPrev: buyDaily === null ? null : buy - buyDaily,
      sellPrev: sellDaily === null ? null : sell - sellDaily,
    },
  };
}

/**
 * PDF の行から MarginFile を作る。株数の行が 1 件も読めない／基準日が無いときは null（様式変更の検知）。
 * keep を渡すとそのコードだけ残す（4 桁）。
 */
export function buildMarginFile(
  rows: readonly (readonly string[])[],
  sourceUrl: string,
  now: Date,
  keep?: ReadonlySet<string>,
): MarginFile | null {
  const asOf = findAsOf(rows);
  if (!asOf) return null;
  const items: Record<string, MarginItem> = {};
  let parsed = 0;
  for (const row of rows) {
    const r = parseSharesRow(row);
    if (!r) continue;
    parsed += 1;
    if (keep && !keep.has(r.code)) continue;
    items[r.code] = r.item;
  }
  if (parsed === 0) return null;
  return { generatedAt: now.toISOString(), asOf, sourceUrl, items };
}

/** 保存済みの JSON を検証して MarginFile にする（壊れていれば null）。 */
export function parseMarginFile(raw: unknown): MarginFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.asOf !== "string" || typeof o.generatedAt !== "string" || typeof o.sourceUrl !== "string") return null;
  if (!o.items || typeof o.items !== "object") return null;
  const items: Record<string, MarginItem> = {};
  for (const [code, v] of Object.entries(o.items as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const it = v as Record<string, unknown>;
    if (typeof it.buy !== "number" || typeof it.sell !== "number") continue;
    items[code] = {
      buy: it.buy,
      sell: it.sell,
      buyPrev: typeof it.buyPrev === "number" ? it.buyPrev : null,
      sellPrev: typeof it.sellPrev === "number" ? it.sellPrev : null,
    };
  }
  return { generatedAt: o.generatedAt, asOf: o.asOf, sourceUrl: o.sourceUrl, items };
}

/** 基準日から 14 日を超えていれば古い。 */
export function isMarginStale(asOf: string, todayIso: string): boolean {
  return daysBetween(asOf, todayIso) > MARGIN_STALE_DAYS;
}

/** 信用買残 ÷ 20 日平均出来高（倍）。出来高が無い・0 なら null。 */
export function marginRatio(buy: number, avgVolume20: number | null | undefined): number | null {
  if (avgVolume20 === null || avgVolume20 === undefined || !(avgVolume20 > 0)) return null;
  return buy / avgVolume20;
}

/** 生成時刻以外が同じか（同じなら書き換えず、夜間ジョブの差分を増やさない）。 */
export function sameMarginContent(a: MarginFile | null, b: MarginFile): boolean {
  if (!a) return false;
  const strip = (f: MarginFile) => JSON.stringify({ asOf: f.asOf, sourceUrl: f.sourceUrl, items: f.items });
  return strip(a) === strip(b);
}
