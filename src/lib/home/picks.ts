// ホームの「ピックアップ」タブの中の手法の切り替え（BB・短期セカンダリ・中長期セカンダリ・注目度・大量保有・優待）。
// 純関数と定数だけを置く。ページ（Server Component）が URL の ?m= を読んで初期の手法を決め、
// クライアントへ渡すため、"use client" のファイルには置かない（サーバーから関数を呼べなくなるため）。

export const PICK_METHODS = [
  { value: "bb", label: "BB" },
  { value: "short", label: "短期セカンダリ" },
  { value: "mid", label: "中長期セカンダリ" },
  // 注目度ランキング（hot.json。いま熱い上場 1 年以内の銘柄）。以前は中長期セカンダリの中にあった。
  { value: "attention", label: "注目度" },
  { value: "holdings", label: "大量保有" },
  { value: "yutai", label: "優待" },
] as const;

export type PickMethod = (typeof PICK_METHODS)[number]["value"];

/** 手法を直接開く URL のクエリ名（例: /?tab=hot&m=bb）。 */
export const PICK_METHOD_PARAM = "m";

const METHOD_VALUES = new Set<string>(PICK_METHODS.map((m) => m.value));

/** 以前の URL の値 → いまの手法（?m=secondary は中長期セカンダリ）。 */
const METHOD_ALIASES: Readonly<Record<string, PickMethod>> = { secondary: "mid" };

/**
 * ?m= が無いときの手法。BB を受け付けている銘柄があれば BB、
 * 無ければ上場前日〜上場 5 日目の銘柄があれば短期セカンダリ、どちらも無ければ中長期セカンダリ。
 * @param bbOpenCount ピックアップの対象で、いま BB を受け付けている銘柄の数
 * @param shortCount 短期セカンダリの対象の数
 */
export function defaultPickMethod(bbOpenCount: number, shortCount = 0): PickMethod {
  if (bbOpenCount > 0) return "bb";
  return shortCount > 0 ? "short" : "mid";
}

/**
 * URL の ?m= の値から手法を決める。不明な値・未指定・複数指定は fallback。
 * サーバーで決めた値をクライアントへ渡すので、サーバーとクライアントで同じ手法になる。
 * @param raw searchParams の m（string | string[] | undefined）
 * @param fallback 既定の手法（defaultPickMethod の結果）
 */
export function parsePickMethod(raw: unknown, fallback: PickMethod): PickMethod {
  if (typeof raw !== "string") return fallback;
  if (METHOD_VALUES.has(raw)) return raw as PickMethod;
  return Object.prototype.hasOwnProperty.call(METHOD_ALIASES, raw) ? METHOD_ALIASES[raw] : fallback;
}
