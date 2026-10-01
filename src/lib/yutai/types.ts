// 株主優待の先回り買い（public/data/yutai.json）の型。
// 生成は scripts/updater/yutai.ts（大和IR 株主優待ガイドの一覧 ＋ Yahoo Finance の月足）。
// 読み込み時の検証は ./file.ts、候補の並べ替えは src/lib/picks/yutai.ts。
//
// 考え方: 権利確定月 M の優待銘柄について、その前月（M-1）の月足を過去 10 年ぶん見て、
// 勝率・直近 5 年の勝率・前月平均・最大上昇平均を指標別と総合評価で並べる（並べ方は src/lib/picks/yutai.ts）。
// 「過去 10 年」「直近 5 年」は暦年で揃える（実行年を含まない完結した年。2026 年に作れば 2016〜25 年と 2021〜25 年）。
// 株価は分割・配当を補正した値（scripts/updater/yutai.ts の toMonthBars）。

/** 前月の月足 1 本（1 年ぶん）。 */
export interface YutaiCandle {
  /** 西暦 */
  year: number;
  /** 月初の始値 */
  open: number;
  /** 月末の終値 */
  close: number;
  /** 月中の高値（「月初に買って月内にどこまで上がったか」の目安）。取れなければ null */
  high: number | null;
  /** 月中の安値 */
  low: number | null;
}

/** 優待銘柄 1 件（権利確定月ごとの一覧の要素）。 */
export interface YutaiItem {
  /** 証券コード（例 "3160" / "138A"） */
  code: string;
  /** 社名（「(株)」は除く） */
  name: string;
  /** 最低投資金額（円）。取れなければ null */
  minInvest: number | null;
  /** 権利月（例 [5, 11]）。一覧の「権利月：5、11月」から */
  rightsMonths: number[];
  /** 大和IR の銘柄詳細ページ URL */
  detailUrl: string;
  /**
   * 前月（権利確定月の 1 つ前）の月足。古い→新しい順。
   * 直近 10 年（実行年を含まない暦年）のうち取れた年だけ。最大 10 本。
   */
  candles: YutaiCandle[];
  /** 直近 10 年の陽線数 */
  up10: number;
  /** 直近 10 年で月足が取れた本数（上場が浅いと 10 未満） */
  n10: number;
  /** 直近 5 年（実行年を含まない暦年）の陽線数 */
  up5: number;
  /** 直近 5 年で月足が取れた本数 */
  n5: number;
  /** 前月の騰落率（終値/始値 − 1）の平均。比率（0.012 = +1.2%）。本数 0 なら null */
  avgRet10: number | null;
  /** 前月の最大上昇幅（高値/始値 − 1）の平均。比率。利確 +10% が狙えたかの目安。高値が無ければ null */
  avgHighRet10: number | null;
  /** 直近の株価（最新の月足の終値）。取れなければ null */
  price: number | null;
  /** 直近 12 本の完結した月足の高値（株価位置の目安。実行月の未完結の足は含めない）。取れなければ null */
  high12: number | null;
  /** 直近 12 本の完結した月足の安値。取れなければ null */
  low12: number | null;
}

/** 月のベースライン（地合い）の 1 年ぶん。対象月の全銘柄の前月の月足をまとめたもの。 */
export interface YutaiBaselineYear {
  /** 西暦 */
  year: number;
  /** その年の前月の月足が取れた銘柄数 */
  n: number;
  /** 陽線（終値 > 始値）の割合（0〜1）。n が 0 なら null */
  winRate: number | null;
  /** 騰落率（終値/始値 − 1）の平均。比率。n が 0 なら null */
  avgRet: number | null;
  /** 最大上昇幅（高値/始値 − 1）の平均。比率。高値が取れた足が無ければ null */
  avgHighRet: number | null;
}

/**
 * 月のベースライン（地合い）。権利確定月 M の全銘柄（前月の月足が取れたもの）を母集団に、
 * 前月の月足を直近 10 年ぶんまとめる。個別銘柄の数字が「月全体の追い風」以上かを見る物差し。
 */
export interface YutaiBaseline {
  /** 母集団の銘柄数 */
  n: number;
  /** 10 年ぶんの全足（銘柄×年）での陽線の割合。足が無ければ null */
  winRate10: number | null;
  /** 10 年ぶんの全足での騰落率の平均。比率 */
  avgRet10: number | null;
  /** 10 年ぶんの全足での最大上昇幅の平均（高値が無い足は除く）。比率 */
  avgHighRet10: number | null;
  /** 年ごと（古い→新しい、直近 10 年） */
  years: YutaiBaselineYear[];
}

/** 権利確定月 1 つぶんの一覧。 */
export interface YutaiMonth {
  /** 権利確定月（1〜12） */
  month: number;
  /** 月足を見た前月（month − 1。1 月なら 12） */
  prevMonth: number;
  /** 大和IR の一覧 URL（month=M） */
  listUrl: string;
  /** 一覧に載っていた件数（月足が取れなかった銘柄も含む） */
  listedCount: number;
  /** 月足が取れた銘柄 */
  items: YutaiItem[];
  /** 月のベースライン（地合い）。古いファイルには無い（null） */
  baseline: YutaiBaseline | null;
}

/** yutai.json の中身。 */
export interface YutaiFile {
  /** 生成時刻（ISO） */
  generatedAt: string;
  /** 一覧を取った日（YYYY-MM-DD、JST） */
  asOf: string;
  /** 権利確定月（"1"〜"12"）→ 一覧 */
  months: Record<string, YutaiMonth>;
}

/** 出典の表記（画面に出す）。 */
export const YUTAI_SOURCE = {
  name: "大和IR 株主優待ガイド",
  url: "https://yutai-guide.daiwair.co.jp/",
} as const;

/** 権利確定月 M の一覧 URL。 */
export function yutaiListUrl(month: number): string {
  return `https://yutai-guide.daiwair.co.jp/stock?keyword=&month=${month}&ct_id=&sort_id=&pager=`;
}

/** 権利確定月 M の前月（1 → 12）。 */
export function prevMonthOf(month: number): number {
  return month === 1 ? 12 : month - 1;
}

// ---------------------------------------------------------------------------
// 配信用の分割ファイル（public/data/yutai/）。
// yutai.json 全体は約 2MB あり、Worker にバンドルすると無料枠の上限（圧縮後 3MB）に迫るため、
// アプリは全体ファイルを読まず、権利確定月ごとの静的ファイルをブラウザから直接取る。
//   - public/data/yutai/index.json : YutaiIndexFile（取得日と月ごとの件数）
//   - public/data/yutai/<M>.json   : YutaiMonthFile（M = 1〜12）
// ---------------------------------------------------------------------------

/** public/data/yutai/<M>.json の中身（1 か月ぶん＋取得日）。 */
export interface YutaiMonthFile extends YutaiMonth {
  /** 一覧を取った日（YYYY-MM-DD、JST） */
  asOf: string;
  /** 生成時刻（ISO） */
  generatedAt: string;
}

/** public/data/yutai/index.json の中身。 */
export interface YutaiIndexFile {
  generatedAt: string;
  asOf: string;
  /** 権利確定月（"1"〜"12"）→ 件数 */
  months: Record<string, { listedCount: number; itemCount: number }>;
}

/** 権利確定月 M の分割ファイルの URL（サイト相対）。 */
export function yutaiMonthFileUrl(month: number): string {
  return `/data/yutai/${month}.json`;
}

/** 分割ファイルの索引の URL（サイト相対）。 */
export const YUTAI_INDEX_URL = "/data/yutai/index.json";
