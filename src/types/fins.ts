// J-Quants 財務サマリから作る fins.json の型。夜間ジョブ（scripts/updater/fins.ts）が書き、画面が読む。
// 無料枠は約 12 週遅延のため、直近の決算ほど入っていない（asOf を必ず併記する）。

/** J-Quants /fins/summary の生行（使う列だけ。数値は文字列・空・null のことがある）。 */
export interface FinsRawRow {
  DiscDate: string;
  DiscTime?: string | null;
  DiscNo?: string | null;
  /** 5 桁（末尾 0 なら 4 桁に正規化して使う） */
  Code: string;
  DocType?: string | null;
  /** 1Q / 2Q / 3Q / FY */
  CurPerType?: string | null;
  CurPerSt?: string | null;
  CurPerEn?: string | null;
  CurFYSt?: string | null;
  CurFYEn?: string | null;
  NxtFYEn?: string | null;
  Sales?: string | number | null;
  OP?: string | number | null;
  OdP?: string | number | null;
  NP?: string | number | null;
  EPS?: string | number | null;
  TA?: string | number | null;
  Eq?: string | number | null;
  /** 自己資本比率（元データは 0.502 のような比率） */
  EqAR?: string | number | null;
  BPS?: string | number | null;
  CFO?: string | number | null;
  CFI?: string | number | null;
  CFF?: string | number | null;
  CashEq?: string | number | null;
  FSales?: string | number | null;
  FOP?: string | number | null;
  FOdP?: string | number | null;
  FNP?: string | number | null;
  FSales2Q?: string | number | null;
  FOP2Q?: string | number | null;
  ShOutFY?: string | number | null;
  TrShFY?: string | number | null;
}

export type FinsQuarterType = "1Q" | "2Q" | "3Q";

export interface FinsFy {
  /** 決算期末（YYYY-MM） */
  period: string;
  /** 売上高・営業利益・純利益（円） */
  sales: number | null;
  op: number | null;
  np: number | null;
  /** 自己資本比率（%） */
  eqAR: number | null;
  /** 営業キャッシュフロー（円） */
  cfo: number | null;
  /** 期末発行済株式数（自己株を含む） */
  sharesOutstanding: number | null;
  discDate: string;
}

export interface FinsPrevFy {
  period: string;
  sales: number | null;
  op: number | null;
}

/** 最新の通期予想（その期の最後の修正を反映）。 */
export interface FinsForecast {
  /** 予想の対象期末（YYYY-MM） */
  period: string;
  sales: number | null;
  op: number | null;
  np: number | null;
  discDate: string;
}

export interface FinsLatestQuarter {
  type: FinsQuarterType;
  /** 四半期末（YYYY-MM-DD） */
  periodEnd: string;
  /** 期初からの累計値（単独値で開示された場合は過去四半期を足した値） */
  sales: number | null;
  op: number | null;
  discDate: string;
  /** 累計 OP ÷ 通期予想 OP × 100（予想なし・予想が 0 以下なら null） */
  progressOpPct: number | null;
  progressSalesPct: number | null;
  /** 開示値が累計か（1Q と 2Q の比較で判定。判定不能は null で、累計として扱う） */
  cumulative: boolean | null;
}

export interface FinsItem {
  code: string;
  fy: FinsFy | null;
  prevFy: FinsPrevFy | null;
  forecast: FinsForecast | null;
  latestQuarter: FinsLatestQuarter | null;
}

export interface FinsFile {
  generatedAt: string;
  /** 取り込んだ最新の開示日（YYYY-MM-DD） */
  asOf: string;
  source: "J-Quants";
  delayNote: "無料枠は約12週遅延";
  items: Record<string, FinsItem>;
}
