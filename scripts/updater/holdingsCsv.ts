import { parseDelimited } from "./csv";
import { readZipEntries } from "./zip";

// 大量保有報告書・変更報告書の CSV（EDINET API v2 の書類取得 type=5）を読む。
//
// 2026-09-30 に実データ（2026-04 と 2026-09 の提出。新様式・旧様式の両方）で確かめた形:
// - ZIP の中に XBRL_TO_CSV/jplvh010000-lvh-001_<提出者コード>-000_<義務発生日>_<回>_<提出日>.csv が 1 つ。
//   ファイル名の jplvhNNNNNN は様式（010000＝第一号様式、020000＝短期大量譲渡）。
// - 文字コードは UTF-16LE（BOM あり）、タブ区切り、全項目ダブルクォート、行末 CRLF。
//   列: 要素ID, 項目名, コンテキストID, 相対年度, 連結・個別, 期間・時点, ユニットID, 単位, 値
// - 値が無いときは全角の「－」。
// - 割合（HoldingRatioOfShareCertificatesEtc・...PerLastReport）は小数（0.1638＝16.38%）。
// - コンテキスト:
//     合計（提出者＋共同保有者）＝ "FilingDateInstant"。ただし共同保有者がいない（1 名）の書類には合計の行が無く、
//       提出者の "FilingDateInstant_jplvh010000-lvh_E38870-000FilerLargeVolumeHolder1Member" だけにある。
//     提出者・共同保有者ごと＝ "..._FilerLargeVolumeHolder{n}Member"。保有目的（PurposeOfHolding）はこちらにだけある。
//   同じ要素・コンテキストの行が 2 回出ることがある（表が 2 か所にあるため。値は同じ）。先の行を使う。
// - 訂正報告書（docTypeCode 360）の CSV は訂正後の全文で、AmendmentFlagDEI=true、
//   IdentificationOfDocumentSubjectToAmendmentDEI に訂正前の docID、FilingDateCoverPage は訂正前の提出日。
// - 短期大量譲渡（jplvh020000）には前回割合の行が無いことがある。

/** CSV から取り出した値。 */
export interface ParsedHoldingReport {
  /** 様式（ファイル名の jplvhNNNNNN の数字。例 "010000"。不明は ""） */
  schema: string;
  /** 発行者名（CSV の表記そのまま） */
  issuerName: string;
  /** 発行者の証券コード（4 桁。例 "4436"・"623A"。無ければ ""） */
  issuerSecCode: string;
  /** 提出者（筆頭）の名前 */
  filer: string;
  /** 提出者＋共同保有者の人数 */
  holders: number | null;
  ratio: number | null;
  prevRatio: number | null;
  shares: number | null;
  /** 保有目的（重複を除いて「／」でつなぐ） */
  purpose: string;
  /** 重要提案行為等の欄に記載がある */
  proposal: boolean;
  /** 変更報告書の提出事由（無ければ ""） */
  reason: string;
  /** 報告義務発生日（YYYY-MM-DD。無ければ ""） */
  obligationDate: string;
  /** 提出日（表紙。訂正報告書では訂正前の提出日。無ければ ""） */
  filingDate: string;
  /** 訂正報告書のとき訂正前の docID（そうでなければ null） */
  amendmentOf: string | null;
}

const TOTAL_CONTEXT = "FilingDateInstant";
const HOLDER_CONTEXT = /FilerLargeVolumeHolder(\d+)Member$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 保有目的 1 件あたりの最大文字数（holdings.json を小さく保つ）。 */
export const PURPOSE_MAX_CHARS = 60;
/** 保有目的（つないだ後）の最大文字数。 */
export const PURPOSE_TOTAL_MAX_CHARS = 140;
/** 提出事由の最大文字数。 */
export const REASON_MAX_CHARS = 80;

/** バイト列を文字列にする（UTF-16LE の BOM があれば UTF-16LE、無ければ UTF-8）。 */
export function decodeCsvBytes(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  return new TextDecoder("utf-8").decode(buf);
}

/** 「－」「-」「該当事項なし」などの空の値か。 */
function isBlank(v: string | undefined): boolean {
  if (v === undefined) return true;
  const t = v.trim();
  return t === "" || t === "－" || t === "-" || t === "―" || t === "‐";
}

/** 全角英数・全角空白を半角にし、空白の連続を 1 つにする（表示用）。 */
export function normalizeText(v: string): string {
  return v.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function truncate(v: string, max: number): string {
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function toNumber(v: string | undefined): number | null {
  if (isBlank(v)) return null;
  const n = Number(v!.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toRatio(v: string | undefined): number | null {
  const n = toNumber(v);
  // 小数で入っている（0〜1）。まれに％の数値（例 16.38）で入っていたら小数に直す
  if (n === null || n < 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return Math.round(n * 100) / 10000;
  return null;
}

type Values = Map<string, Map<string, string>>;

/** 要素ID（名前空間を除く）→ コンテキストID → 値。同じ組の 2 回目以降は無視する。 */
function collect(rows: string[][]): Values {
  const out: Values = new Map();
  for (const r of rows) {
    if (r.length < 9) continue;
    const id = r[0].replace(/^[^:]*:/, "");
    const ctx = r[2];
    let byCtx = out.get(id);
    if (!byCtx) {
      byCtx = new Map();
      out.set(id, byCtx);
    }
    if (!byCtx.has(ctx)) byCtx.set(ctx, r[8]);
  }
  return out;
}

function holderIndex(ctx: string): number | null {
  const m = ctx.match(HOLDER_CONTEXT);
  return m ? Number(m[1]) : null;
}

/** 提出者・共同保有者ごとの値を、番号順に並べて返す。 */
function perHolder(values: Values, id: string): string[] {
  const byCtx = values.get(id);
  if (!byCtx) return [];
  return [...byCtx.entries()]
    .flatMap(([ctx, v]) => {
      const n = holderIndex(ctx);
      return n === null ? [] : [{ n, v }];
    })
    .sort((a, b) => a.n - b.n)
    .map((x) => x.v);
}

/**
 * 合計の値を返す。合計の行（FilingDateInstant）があればそれ、無ければ提出者が 1 名のときはその値、
 * 複数名なら各人の値の合計（sum が true のとき）。
 */
function totalOf(values: Values, id: string, parse: (v: string | undefined) => number | null): number | null {
  const byCtx = values.get(id);
  if (!byCtx) return null;
  if (byCtx.has(TOTAL_CONTEXT)) return parse(byCtx.get(TOTAL_CONTEXT));
  const each = perHolder(values, id).map((v) => parse(v));
  if (each.length === 0 || each.every((v) => v === null)) return null;
  if (each.length === 1) return each[0];
  return each.reduce<number>((s, v) => s + (v ?? 0), 0);
}

function cover(values: Values, id: string): string {
  const v = values.get(id)?.get(TOTAL_CONTEXT);
  return isBlank(v) ? "" : v!.trim();
}

/** CSV の文字列（デコード済み）を読む。schema はファイル名から取った様式（分からなければ ""）。 */
export function parseHoldingCsv(text: string, schema = ""): ParsedHoldingReport {
  const rows = parseDelimited(text, "\t");
  const values = collect(rows.slice(1));

  const purposes: string[] = [];
  for (const p of perHolder(values, "PurposeOfHolding")) {
    if (isBlank(p)) continue;
    const t = truncate(normalizeText(p), PURPOSE_MAX_CHARS);
    if (!purposes.includes(t)) purposes.push(t);
  }
  const proposal = perHolder(values, "ActOfMakingImportantProposalEtc").some(
    (v) => !isBlank(v) && !/該当(事項)?(は)?(なし|ありません)|^なし$/.test(normalizeText(v)),
  );

  const filer =
    cover(values, "FilerNameInJapaneseDEI") ||
    perHolder(values, "Name").find((v) => !isBlank(v)) ||
    cover(values, "NameCoverPage");
  const holders = toNumber(values.get("TotalNumberOfFilersAndJointHoldersCoverPage")?.get(TOTAL_CONTEXT));
  const obligationDate = cover(values, "DateWhenFilingRequirementAroseCoverPage");
  const filingDate = cover(values, "FilingDateCoverPage");
  const amendmentFlag = cover(values, "AmendmentFlagDEI") === "true";
  const amendmentOf = cover(values, "IdentificationOfDocumentSubjectToAmendmentDEI");
  const issuerSecCode = cover(values, "SecurityCodeOfIssuer").normalize("NFKC");

  return {
    schema,
    issuerName: normalizeText(cover(values, "NameOfIssuer")),
    issuerSecCode: /^[0-9A-Z]{4}$/.test(issuerSecCode) ? issuerSecCode : "",
    filer: normalizeText(filer ?? ""),
    holders: holders !== null && holders >= 1 ? Math.round(holders) : null,
    ratio: totalOf(values, "HoldingRatioOfShareCertificatesEtc", toRatio),
    prevRatio: totalOf(values, "HoldingRatioOfShareCertificatesEtcPerLastReport", toRatio),
    shares: totalOf(values, "TotalNumberOfStocksEtcHeld", toNumber),
    purpose: truncate(purposes.join("／"), PURPOSE_TOTAL_MAX_CHARS),
    proposal,
    reason: truncate(normalizeText(cover(values, "ReasonForFilingChangeReportCoverPage")), REASON_MAX_CHARS),
    obligationDate: ISO_DATE.test(obligationDate) ? obligationDate : "",
    filingDate: ISO_DATE.test(filingDate) ? filingDate : "",
    amendmentOf: amendmentFlag && amendmentOf ? amendmentOf : null,
  };
}

/** type=5 の ZIP を読む。大量保有の CSV（jplvh*.csv）が無ければ例外。 */
export function parseHoldingCsvZip(zip: Buffer): ParsedHoldingReport {
  const entries = readZipEntries(zip).filter((e) => /\.csv$/i.test(e.name));
  const entry = entries.find((e) => /(^|\/)jplvh\d{6}/.test(e.name)) ?? entries[0];
  if (!entry) throw new Error("ZIP に CSV が無い");
  const schema = entry.name.match(/jplvh(\d{6})/)?.[1] ?? "";
  return parseHoldingCsv(decodeCsvBytes(entry.data), schema);
}
