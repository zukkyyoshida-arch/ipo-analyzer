// 大量保有報告書（holdings.json）の型と出典表記の定数。
// 生成は scripts/updater/holdings.ts（夜間のデータ更新）。読み込みは ./file.ts、選定は ./score.ts。
//
// データの意味（EDINET API v2 の書類一覧＋CSV（type=5）を 2026-09-30 に実データで確かめた内容）:
// - 1 件 = 1 銘柄 × 1 提出。訂正報告書（docTypeCode 360）は訂正前の書類を置き換える（amendedFrom に訂正前の docID）。
// - 割合は小数（0.1638 = 16.38%）。CSV の値そのまま。合計（提出者＋共同保有者）の値を使う。
// - 日付は YYYY-MM-DD。

/**
 * 書類の種類（EDINET の formCode から決める）。
 * - new:            大量保有報告書（formCode 010000）
 * - change:         変更報告書（010002）
 * - bulkTransfer:   変更報告書（短期大量譲渡）（020002）
 * - newSpecial:     大量保有報告書（特例対象株券等）（030000）
 * - changeSpecial:  変更報告書（特例対象株券等）（030002）
 */
export type HoldingFormType = "new" | "change" | "bulkTransfer" | "newSpecial" | "changeSpecial";

export const HOLDING_FORM_TYPES: readonly HoldingFormType[] = [
  "new",
  "change",
  "bulkTransfer",
  "newSpecial",
  "changeSpecial",
];

/** 書類の種類の表示名。 */
export const HOLDING_FORM_LABELS: Record<HoldingFormType, string> = {
  new: "大量保有報告書",
  change: "変更報告書",
  bulkTransfer: "変更報告書（短期大量譲渡）",
  newSpecial: "大量保有報告書（特例）",
  changeSpecial: "変更報告書（特例）",
};

/** holdings.json の items の 1 件（銘柄 × 提出）。 */
export interface HoldingItem {
  /** 銘柄コード（4 桁。例 "623A"） */
  code: string;
  /** 銘柄名（カブナビ の表記） */
  name: string;
  /** EDINET の書類管理番号（訂正後の書類なら訂正報告書の docID） */
  docId: string;
  /** 提出日。訂正報告書は訂正前の書類の提出日（動きが公表された日） */
  submitDate: string;
  /** 提出者（連名のときは筆頭の提出者） */
  filer: string;
  /** 提出者＋共同保有者の人数（2 人以上のときだけ入る） */
  holders?: number;
  formType: HoldingFormType;
  /** 今回の保有割合（小数。0.0513 = 5.13%）。取れなければ null */
  ratio: number | null;
  /** 前回の報告の保有割合（小数）。大量保有報告書・記載なしは null */
  prevRatio: number | null;
  /** ratio − prevRatio（小数。+0.012 = +1.2pt）。どちらかが無ければ null */
  delta: number | null;
  /** 保有目的（要約。共同保有者で違うときは「／」でつなぐ。無ければ ""） */
  purpose: string;
  /** 重要提案行為等の記載がある（該当事項なし以外）ときだけ true */
  proposal?: boolean;
  /** 保有株券等の数（合計）。取れなければ null */
  shares: number | null;
  /** 変更報告書の提出事由（大量保有報告書は ""） */
  reason: string;
  /** 報告義務発生日（不明は ""） */
  obligationDate: string;
  /** 銘柄の上場日（上場に伴う報告かどうかの判定に使う。不明は無し） */
  listingDate?: string;
  /** 訂正報告書で置き換えたとき、訂正前の書類の docID */
  amendedFrom?: string;
}

/** holdings.json の中身。 */
export interface HoldingsFile {
  /** 生成時刻（ISO） */
  generatedAt: string;
  /** 取得済みの最も古い提出日（""＝未取得） */
  coveredFrom: string;
  /** 取得済みの最も新しい提出日（この日までの書類一覧は取り終えている。""＝未取得） */
  coveredThrough: string;
  /** 出典表記（HOLDINGS_SOURCE_TEXT） */
  source: string;
  /** 提出日の新しい順 */
  items: HoldingItem[];
}

/** holdings.json に残す期間（提出日から、暦日）。 */
export const HOLDINGS_RETENTION_DAYS = 180;

// ---------------------------------------------------------------------------
// 出典表記（公共データ利用規約 第1.0版＝PDL1.0）
// EDINET の利用規約「PDL1.0に関する重要情報」（https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0030.html）
// の記載例に沿う: ①出典（EDINET閲覧（提出）サイトと PDL1.0 の URL）を書く ②加工したことと主体を別に書く
// ③加工した情報を国が作った未加工の情報のように見せない。
// ---------------------------------------------------------------------------

/** 出典（リンクを張るときの文言と URL）。 */
export const HOLDINGS_ATTRIBUTION = {
  sourceLabel: "EDINET閲覧（提出）サイト",
  sourceUrl: "https://disclosure2.edinet-fsa.go.jp/",
  licenseLabel: "PDL1.0",
  licenseUrl: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
  /** 加工したことと主体（出典とは別に必ず書く） */
  processedNote:
    "EDINET閲覧（提出）サイトの大量保有報告書・変更報告書をもとに カブナビ が加工して作成（注目度・並び順は カブナビ 独自のもので、金融庁が作成したものではありません）",
} as const;

/** 出典表記の全文（リンクを張れない場所・holdings.json の source 用）。 */
export const HOLDINGS_SOURCE_TEXT = `出典：${HOLDINGS_ATTRIBUTION.sourceLabel}（${HOLDINGS_ATTRIBUTION.sourceUrl}）、${HOLDINGS_ATTRIBUTION.licenseLabel}（${HOLDINGS_ATTRIBUTION.licenseUrl}）。${HOLDINGS_ATTRIBUTION.processedNote}`;
