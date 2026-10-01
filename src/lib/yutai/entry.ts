// 優待の先回り買いの「おすすめエントリー金額」と、資金・分散数の選択肢。純関数。
// 売買のルール（前月の月初に買う・+10% で利確・+8% に達したら +5% に逆指値・4〜5 銘柄に均等に分散）を、
// 1 銘柄ぶんの株数と金額に直す。損切りラインは根拠となる資料が無いので出さない。

/** 優待に回す資金の選択肢（万円）。 */
export const YUTAI_BUDGET_OPTIONS_MAN = [10, 20, 30, 50, 100, 150, 200, 300, 500] as const;

/** 分散数の選択肢（1〜5。1 は 1 銘柄に全額）と既定値。 */
export const YUTAI_SPLIT_OPTIONS = [1, 2, 3, 4, 5] as const;
export const YUTAI_DEFAULT_SPLIT = 5;

/** 単元株（東証は 100 株）。 */
export const YUTAI_LOT = 100;
/** 利確の目安（+10%）。 */
export const YUTAI_TAKE_PROFIT = 0.1;
/** 逆指値を引き上げる目安: この上昇（+8%）に達したら */
export const YUTAI_TRAIL_TRIGGER = 0.08;
/** 逆指値を置く位置（+5%）。 */
export const YUTAI_TRAIL_STOP = 0.05;

/**
 * localStorage の資金（万円。文字列か数値）を選択肢に揃える。
 * 空・数字でない・0 以下は null（指定なし）。選択肢に無い値は一番近い選択肢に丸める（同じ近さなら小さい方）。
 */
export function normalizeBudgetMan(raw: unknown): number | null {
  const v = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(v) || v <= 0) return null;
  let best: number = YUTAI_BUDGET_OPTIONS_MAN[0];
  for (const o of YUTAI_BUDGET_OPTIONS_MAN) {
    if (Math.abs(o - v) < Math.abs(best - v)) best = o;
  }
  return best;
}

/** localStorage の分散数を選択肢に揃える（選択肢に無ければ既定の 5）。 */
export function normalizeSplitCount(raw: unknown): number {
  const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return (YUTAI_SPLIT_OPTIONS as readonly number[]).includes(v) ? v : YUTAI_DEFAULT_SPLIT;
}

/** 1 銘柄ぶんのおすすめエントリー。 */
export interface YutaiEntryPlan {
  /** 1 銘柄の枠（円）＝ 資金 ÷ 分散数 */
  frameYen: number;
  /** 推奨株数（100 株単位）。枠で 100 株も買えなければ 0 */
  shares: number;
  /** エントリー金額（円）＝ 推奨株数 × 株価 */
  amountYen: number;
  /** 枠で 100 株も買えない（最低投資額 > 枠） */
  overFrame: boolean;
  /** 利確目安の株価（+10%、円・四捨五入） */
  takeProfitPrice: number;
  /** 利確したときの利益見込み（円）＝ エントリー金額 × 10%（四捨五入） */
  profitYen: number;
  /** 逆指値を引き上げる目安の株価（+8%、円・四捨五入） */
  trailTriggerPrice: number;
  /** 引き上げた逆指値の株価（+5%、円・四捨五入） */
  trailStopPrice: number;
}

/**
 * 株価と資金・分散数から、1 銘柄ぶんのおすすめエントリーを出す（均等配分）。
 * 推奨株数 = floor(枠 ÷ 株価 ÷ 100) × 100。株価が無い・資金や分散数が正でなければ null。
 */
export function yutaiEntryPlan(price: number | null, budgetYen: number, splitCount: number): YutaiEntryPlan | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(budgetYen) || budgetYen <= 0 || !Number.isFinite(splitCount) || splitCount <= 0) return null;
  const frameYen = budgetYen / splitCount;
  const shares = Math.floor(frameYen / price / YUTAI_LOT) * YUTAI_LOT;
  const amountYen = Math.round(shares * price);
  return {
    frameYen,
    shares,
    amountYen,
    overFrame: shares === 0,
    takeProfitPrice: Math.round(price * (1 + YUTAI_TAKE_PROFIT)),
    profitYen: Math.round(amountYen * YUTAI_TAKE_PROFIT),
    trailTriggerPrice: Math.round(price * (1 + YUTAI_TRAIL_TRIGGER)),
    trailStopPrice: Math.round(price * (1 + YUTAI_TRAIL_STOP)),
  };
}
