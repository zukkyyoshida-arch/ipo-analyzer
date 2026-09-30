// ホーム上部のタブ（YouTube Studio 風の TopTabs）。純関数と定数だけを置く。
// ページ（Server Component）が URL の ?tab= を読んで初期タブを決め、クライアントへ渡すため、
// "use client" のファイルには置かない（サーバーから関数を呼べなくなるため）。

// 先頭のタブは手法別のピックアップ（中で BB・セカンダリー・大量保有・優待を切り替える。lib/home/picks.ts）。
// value は以前の「注目度」タブと同じ hot のまま（既存の /?tab=hot のリンクを壊さないため）。
export const HOME_TABS = [
  { value: "hot", label: "ピックアップ" },
  { value: "overview", label: "概要" },
  { value: "upcoming", label: "今後の予定" },
  { value: "results", label: "実績" },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]["value"];

/** ホームを開いたときのタブ（手法ごとの注目銘柄がいちばん大事な情報のため）。 */
export const DEFAULT_HOME_TAB: HomeTab = "hot";

const TAB_VALUES = new Set<string>(HOME_TABS.map((t) => t.value));

/**
 * URL の ?tab= の値からタブを決める。不明な値・未指定・複数指定は既定のタブ。
 * @param raw searchParams の tab（string | string[] | undefined）
 */
export function parseHomeTab(raw: unknown): HomeTab {
  return typeof raw === "string" && TAB_VALUES.has(raw) ? (raw as HomeTab) : DEFAULT_HOME_TAB;
}
