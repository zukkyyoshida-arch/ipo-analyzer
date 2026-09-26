import { HTTP_TIMEOUT_MS, USER_AGENT } from "./config";

// EDINET API v2 から大量保有報告書（docTypeCode "350"）・変更報告書（"360"）を検索する。
//
// - EDINET_API_KEY 環境変数が無ければスキップ（空結果）。キーはコードにハードコードしない。
// - 直近7日分を日単位で直列取得し、リクエスト間は200msあける（ポライトアクセス）。
// - リトライはしない。失敗した日は読み飛ばし、取れた範囲の結果のみ返す。

const EDINET_DOCUMENTS_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json";

/** 大量保有報告書・変更報告書のdocTypeCode。 */
const TARGET_DOC_TYPE_CODES = new Set(["350", "360"]);

/** 検索対象の日数（直近n日分）。 */
const LOOKBACK_DAYS = 7;

/** リクエスト間隔（ミリ秒）。 */
const REQUEST_INTERVAL_MS = 200;

export interface LargeHoldingReport {
  /** 提出日 YYYY-MM-DD */
  date: string;
  /** 提出者名（大量保有者） */
  holder: string;
}

interface EdinetDocument {
  docTypeCode?: string;
  secCode?: string;
  filerName?: string;
  submitDateTime?: string;
}

interface EdinetDocumentsResponse {
  results?: EdinetDocument[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** YYYY-MM-DD 形式の日付文字列を返す（date を n 日前にずらす）。 */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 銘柄コード（4桁+英数字1桁、例: "323A"）を EDINET の secCode（5桁、末尾0）へ変換。 */
export function toEdinetSecCode(code: string): string {
  return `${code}0`;
}

/** "2026-07-10 12:34" 等の submitDateTime から YYYY-MM-DD を取り出す。 */
function toSubmitDate(submitDateTime: string | undefined): string | null {
  if (!submitDateTime) return null;
  const m = submitDateTime.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 1日分の書類一覧を取得する（type=2: 提出書類一覧+メタデータ）。失敗時は空配列。 */
async function fetchDocumentsForDate(
  dateStr: string,
  apiKey: string,
): Promise<EdinetDocument[]> {
  const url = `${EDINET_DOCUMENTS_URL}?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`EDINET fetch failed (${dateStr}): HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as EdinetDocumentsResponse;
    return json.results ?? [];
  } catch (err) {
    console.warn(`EDINET fetch error (${dateStr}):`, (err as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 対象銘柄コード群について、直近 LOOKBACK_DAYS 日分の大量保有報告書/変更報告書を検索し、
 * 銘柄コードごとに最新1件を返す。EDINET_API_KEY 未設定なら空Mapを返す（スキップ）。
 */
export async function fetchLargeHoldingReports(
  codes: string[],
): Promise<Map<string, LargeHoldingReport>> {
  const result = new Map<string, LargeHoldingReport>();
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) {
    console.log("EDINET: スキップ（EDINET_API_KEY未設定）");
    return result;
  }
  if (codes.length === 0) return result;

  const secCodeToCode = new Map<string, string>();
  for (const code of codes) {
    secCodeToCode.set(toEdinetSecCode(code), code);
  }

  const today = new Date();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const target = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const dateStr = toDateString(target);

    const docs = await fetchDocumentsForDate(dateStr, apiKey);
    for (const doc of docs) {
      if (!doc.docTypeCode || !TARGET_DOC_TYPE_CODES.has(doc.docTypeCode)) continue;
      if (!doc.secCode) continue;
      const code = secCodeToCode.get(doc.secCode);
      if (!code) continue;

      const submitDate = toSubmitDate(doc.submitDateTime) ?? dateStr;
      const existing = result.get(code);
      // 銘柄ごとに最新1件（提出日が新しい方）を採用。
      if (!existing || submitDate > existing.date) {
        result.set(code, {
          date: submitDate,
          holder: doc.filerName ?? "",
        });
      }
    }

    // 最終日はリクエスト後の待機不要。
    if (i < LOOKBACK_DAYS - 1) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  return result;
}
