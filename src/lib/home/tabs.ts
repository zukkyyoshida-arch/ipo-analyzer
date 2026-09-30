// ホーム上部のタブ（YouTube Studio 風の TopTabs）。純関数と定数だけを置く。
// ページ（Server Component）が URL の ?tab= を読んで初期タブを決め、クライアントへ渡すため、
// "use client" のファイルには置かない（サーバーから関数を呼べなくなるため）。

export const HOME_TABS = [
  { value: "hot", label: "注目度" },
  { value: "overview", label: "概要" },
  { value: "upcoming", label: "今後の予定" },
  { value: "results", label: "実績" },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]["value"];

/** ホームを開いたときのタブ（注目度ランキングがいちばん大事な情報のため）。 */
export const DEFAULT_HOME_TAB: HomeTab = "hot";

const TAB_VALUES = new Set<string>(HOME_TABS.map((t) => t.value));

/**
 * URL の ?tab= の値からタブを決める。不明な値・未指定・複数指定は既定のタブ。
 * @param raw searchParams の tab（string | string[] | undefined）
 */
export function parseHomeTab(raw: unknown): HomeTab {
  return typeof raw === "string" && TAB_VALUES.has(raw) ? (raw as HomeTab) : DEFAULT_HOME_TAB;
}
