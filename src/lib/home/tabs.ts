// ホーム上部のタブ（YouTube Studio 風の TopTabs）。純関数と定数だけを置く。
// ページ（Server Component）が URL の ?tab= を読んで初期タブを決め、クライアントへ渡すため、
// "use client" のファイルには置かない（サーバーから関数を呼べなくなるため）。

// 先頭のタブは手法別のピックアップ（中で BB・セカンダリ・注目度・大量保有・優待を切り替える。lib/home/picks.ts）。
// value は以前の「注目度」タブと同じ hot のまま（既存の /?tab=hot のリンクを壊さないため）。
export const HOME_TABS = [
  { value: "hot", label: "ピックアップ" },
  // 売買カレンダー（?tab=calendar）。端末の localStorage だけで持つ。
  { value: "calendar", label: "売買カレンダー" },
  // 分析（以前の「概要」と「実績」を 1 つにまとめたもの）。
  { value: "analytics", label: "分析" },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]["value"];

/** ホームを開いたときのタブ（手法ごとの注目銘柄がいちばん大事な情報のため）。 */
export const DEFAULT_HOME_TAB: HomeTab = "hot";

const TAB_VALUES = new Set<string>(HOME_TABS.map((t) => t.value));

/**
 * 以前の URL の値 → いまのタブ。「概要」「実績」は「分析」にまとめた。
 * 「今後の予定」（upcoming）は /events に統合したため、ページ（page.tsx）が /events へ転送する。
 * ここではホームを開いたとき用にピックアップへ寄せておく。
 */
const TAB_ALIASES: Readonly<Record<string, HomeTab>> = {
  overview: "analytics",
  results: "analytics",
  upcoming: "hot",
};

/** 「今後の予定」タブの以前の値（/?tab=upcoming は /events へ転送する）。 */
export const LEGACY_UPCOMING_TAB = "upcoming";

/**
 * URL の ?tab= の値からタブを決める。不明な値・未指定・複数指定は既定のタブ。
 * @param raw searchParams の tab（string | string[] | undefined）
 */
export function parseHomeTab(raw: unknown): HomeTab {
  if (typeof raw !== "string") return DEFAULT_HOME_TAB;
  if (TAB_VALUES.has(raw)) return raw as HomeTab;
  return Object.prototype.hasOwnProperty.call(TAB_ALIASES, raw) ? TAB_ALIASES[raw] : DEFAULT_HOME_TAB;
}
