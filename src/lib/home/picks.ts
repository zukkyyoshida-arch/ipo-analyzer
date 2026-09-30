// ホームの「ピックアップ」タブの中の手法の切り替え（BB・セカンダリー・大量保有・優待）。純関数と定数だけを置く。
// ページ（Server Component）が URL の ?m= を読んで初期の手法を決め、クライアントへ渡すため、
// "use client" のファイルには置かない（サーバーから関数を呼べなくなるため）。

export const PICK_METHODS = [
  { value: "bb", label: "BB" },
  { value: "secondary", label: "セカンダリー" },
  { value: "holdings", label: "大量保有" },
  { value: "yutai", label: "優待" },
] as const;

export type PickMethod = (typeof PICK_METHODS)[number]["value"];

/** 手法を直接開く URL のクエリ名（例: /?tab=hot&m=bb）。 */
export const PICK_METHOD_PARAM = "m";

const METHOD_VALUES = new Set<string>(PICK_METHODS.map((m) => m.value));

/**
 * ?m= が無いときの手法。BB を受け付けている銘柄があれば BB、無ければセカンダリー。
 * @param bbOpenCount ピックアップの対象で、いま BB を受け付けている銘柄の数
 */
export function defaultPickMethod(bbOpenCount: number): PickMethod {
  return bbOpenCount > 0 ? "bb" : "secondary";
}

/**
 * URL の ?m= の値から手法を決める。不明な値・未指定・複数指定は fallback。
 * サーバーで決めた値をクライアントへ渡すので、サーバーとクライアントで同じ手法になる。
 * @param raw searchParams の m（string | string[] | undefined）
 * @param fallback 既定の手法（defaultPickMethod の結果）
 */
export function parsePickMethod(raw: unknown, fallback: PickMethod): PickMethod {
  return typeof raw === "string" && METHOD_VALUES.has(raw) ? (raw as PickMethod) : fallback;
}
