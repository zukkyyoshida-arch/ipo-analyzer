// foreign.json（有価証券報告書「所有者別状況」の外国法人等比率）の型。
// 中長期セカンダリの④株主構成（外国人株主の比率・増加）の参考表示に使う。

/** 1 銘柄分（直近の有報＝当期と、その前の期）。 */
export interface ForeignItem {
  /** 外国法人等（個人以外＋個人）の所有株式数の割合（%。例 12.3） */
  ratioPercent: number;
  /** 当期の事業年度末（YYYY-MM-DD） */
  fiscalYearEnd: string;
  /** 有報の提出日（YYYY-MM-DD） */
  submitDate: string;
  /** EDINET の書類管理番号 */
  docId: string;
  /** 前期の割合（%）。前期の有報を取れていなければ省略 */
  prevRatioPercent?: number;
  /** 前期の事業年度末（YYYY-MM-DD） */
  prevFiscalYearEnd?: string;
}

export interface ForeignFile {
  /** 生成時刻（ISO 8601） */
  generatedAt: string;
  /** EDINET の書類一覧をこの日（YYYY-MM-DD）まで途切れなく走査済み。次回はこの翌日から */
  scannedThrough: string;
  /** 4 桁の銘柄コード → 外国法人等比率 */
  items: Record<string, ForeignItem>;
}
