// margin.json（JPX「銘柄別信用取引残高」から作る信用残）の型。
// 中長期セカンダリの「信用買残 ÷ 直近出来高」チェックに使う。

/** 1 銘柄分（株数。合計＝一般信用＋制度信用）。 */
export interface MarginItem {
  /** 買残（株） */
  buy: number;
  /** 売残（株） */
  sell: number;
  /** 前回公表分の買残（株）。JPX の前日比から逆算。取れなければ null/省略 */
  buyPrev?: number | null;
  /** 前回公表分の売残（株） */
  sellPrev?: number | null;
}

export interface MarginFile {
  /** 生成時刻（ISO 8601） */
  generatedAt: string;
  /** 残高の基準日（申込み現在の日付 YYYY-MM-DD） */
  asOf: string;
  /** 取得元の URL */
  sourceUrl: string;
  /** 4 桁の銘柄コード（新コードは 130A のような英字入り）→ 残高 */
  items: Record<string, MarginItem>;
}
