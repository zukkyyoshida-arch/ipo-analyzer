// 株主優待の先回り買い（public/data/yutai.json）の型。
// 生成は scripts/updater/yutai.ts（大和IR 株主優待ガイドの一覧 ＋ Yahoo Finance の月足）。
// 読み込み時の検証は ./file.ts、候補の並べ替えは src/lib/picks/yutai.ts。
//
// 考え方: 権利確定月 M の優待銘柄について、その前月（M-1）の月足を過去 10 年ぶん見て
// 「陽線（終値 > 始値）の本数と割合」が高い銘柄を上に出す。

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
  /** 優待利回り（%）。取れなければ null */
  yutaiYield: number | null;
  /** 配当利回り（%）。取れなければ null */
  divYield: number | null;
  /** 実質利回り（%、配当＋優待）。取れなければ null */
  totalYield: number | null;
  /** 権利月（例 [5, 11]）。一覧の「権利月：5、11月」から */
  rightsMonths: number[];
  /** 大和IR の銘柄詳細ページ URL */
  detailUrl: string;
  /**
   * 前月（権利確定月の 1 つ前）の月足。古い→新しい順。
   * 完結した年だけ（当年の前月がまだ終わっていなければ含めない）。最大 10 本。
   */
  candles: YutaiCandle[];
  /** 直近 10 年の陽線数 */
  up10: number;
  /** 直近 10 年で月足が取れた本数（上場が浅いと 10 未満） */
  n10: number;
  /** 直近 5 年の陽線数 */
  up5: number;
  /** 直近 5 年で月足が取れた本数 */
  n5: number;
  /** 前月の騰落率（終値/始値 − 1）の平均。比率（0.012 = +1.2%）。本数 0 なら null */
  avgRet10: number | null;
  /** 前月の最大上昇幅（高値/始値 − 1）の平均。比率。利確 +10% が狙えたかの目安。高値が無ければ null */
  avgHighRet10: number | null;
  /** 直近の株価（最新の月足の終値）。取れなければ null */
  price: number | null;
  /** 直近 12 ヶ月の月足の高値（株価位置の目安）。取れなければ null */
  high12: number | null;
  /** 直近 12 ヶ月の月足の安値。取れなければ null */
  low12: number | null;
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
