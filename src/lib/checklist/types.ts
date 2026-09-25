// 投資判断チェックリストの型定義。
// フェーズ別（BB申込／上場当日／セカンダリー）にIPO投資法則を機械的に照合し、
// 表示専用の情報として提供する。総合スコアには合算しない。

/** チェックリストのフェーズ */
export type ChecklistPhase = "bb" | "listingDay" | "secondary";

/** 判定結果。pass=条件クリア / warn=注意 / fail=警戒 / unknown=データ不足で判定不能 / manual=人手での確認が必要 */
export type ChecklistVerdict = "pass" | "warn" | "fail" | "unknown" | "manual";

export interface ChecklistItem {
  id: string;
  /** 項目名（日本語） */
  label: string;
  verdict: ChecklistVerdict;
  /** 判定根拠テキスト（日本語） */
  detail: string;
}

export interface ChecklistSection {
  phase: ChecklistPhase;
  /** フェーズ名（日本語） */
  label: string;
  items: ChecklistItem[];
}

export interface ChecklistResult {
  /** 現在のフェーズ */
  phase: ChecklistPhase;
  /** 現在のフェーズ名（日本語） */
  phaseLabel: string;
  /** 3フェーズ全セクション（UIで現在フェーズを強調表示するために全件返す） */
  sections: ChecklistSection[];
  /** 現在フェーズのみの verdict 集計 */
  counts: Record<ChecklistVerdict, number>;
}
