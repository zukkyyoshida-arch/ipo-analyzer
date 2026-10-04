// EDINET API v2 の小さなクライアント（書類一覧 documents.json と書類取得 documents/{docID}）。
// Node の fs に依存しないので、夜間ジョブ（scripts/updater）と Cloudflare Worker（日中取得）の両方から使う。
// Worker では nodejs_compat の Buffer を使う。
//
// 大量保有報告書まわりの docTypeCode / formCode（EDINET API 仕様書・様式コードリスト。2026-09-30 に実データで確認）:
//   docTypeCode 350 = 大量保有報告書・変更報告書（formCode で区別する）
//     010000 大量保有報告書 / 010002 変更報告書 / 020002 変更報告書（短期大量譲渡）
//     030000 大量保有報告書（特例対象株券等）/ 030002 変更報告書（特例対象株券等）
//   docTypeCode 360 = 訂正報告書（大量保有報告書・変更報告書）。formCode 090001。
//     parentDocID に訂正前の書類の docID が入る。訂正後の内容で元の書類を置き換える。
//   （以前のコメントにあった「360＝変更報告書」は誤り。変更報告書は 350 の formCode 010002）
//
// マナー（EDINET 利用規約「短時間における大量のアクセス」の禁止に沿う）:
// - 1 本ずつ順番に投げ、リクエストの間を REQUEST_INTERVAL_MS あける。
// - 429・5xx・通信エラーは指数バックオフで数回だけ再試行し、だめならその回の取得を打ち切る。
// - 401/403（キーの誤り・無効）は再試行しない。
// - API キーはクエリ（Subscription-Key）で渡す。ログ・例外の文言にキーや URL を出さない。

const EDINET_API_BASE = "https://api.edinet-fsa.go.jp/api/v2";

/** リクエストの間隔（ミリ秒）。1〜2 秒の間で決めた設計値。 */
export const REQUEST_INTERVAL_MS = 1_500;
/** 再試行の回数。 */
export const MAX_RETRIES = 4;
/** 再試行の待ち時間の初期値（ミリ秒）。5 秒 → 10 秒 → 20 秒 → 40 秒。 */
export const BACKOFF_BASE_MS = 5_000;
/** 1 リクエストのタイムアウト（ミリ秒）。 */
export const EDINET_TIMEOUT_MS = 60_000;
/** User-Agent の既定値（scripts/updater/config.ts の USER_AGENT と同じ文言）。 */
export const EDINET_USER_AGENT = "ipo-analyzer-updater/1.0 (+personal use; polite single-page fetch)";
/** Retry-After の上限（ミリ秒）。 */
const RETRY_AFTER_MAX_MS = 120_000;

/** 書類一覧（type=2）の 1 件のうち、使う項目。 */
export interface EdinetDocMeta {
  docID: string;
  edinetCode?: string | null;
  filerName?: string | null;
  docTypeCode?: string | null;
  formCode?: string | null;
  issuerEdinetCode?: string | null;
  parentDocID?: string | null;
  submitDateTime?: string | null;
  /** "0"＝通常 / "1"＝取下書 / "2"＝取り下げられた書類 */
  withdrawalStatus?: string | null;
  /** "0"＝修正なし / "1"＝修正後の書類情報 / "2"＝修正前の書類情報（同じ docID の 2 行目に出る） */
  docInfoEditStatus?: string | null;
  csvFlag?: string | null;
  /** 証券コード（5 桁。例 "80410"）。有報など提出者＝発行会社の書類で入る */
  secCode?: string | null;
  /** 対象期間の終了日（有報なら事業年度末 YYYY-MM-DD） */
  periodEnd?: string | null;
}

/** 書類一覧・CSV の取得（テストでは偽物に差し替える）。 */
export interface EdinetApi {
  /** 1 日分の書類一覧。取れなければ例外 */
  listDocuments(date: string): Promise<EdinetDocMeta[]>;
  /** CSV（type=5）の ZIP。書類が無い（404）ときは null。それ以外で取れなければ例外 */
  fetchCsvZip(docId: string): Promise<Buffer | null>;
  /** これまでに投げたリクエストの数（再試行を含む） */
  readonly requestCount: number;
}

/** キーの誤りなど、再試行しても直らない失敗。 */
export class EdinetFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdinetFatalError";
  }
}

/** 再試行しても取れなかった失敗（その回の取得を打ち切る）。 */
export class EdinetRetryExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdinetRetryExhaustedError";
  }
}

export interface EdinetClientOptions {
  intervalMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 文言からキーを伏せる（念のため。URL は文言に入れない方針）。 */
export function redactKey(message: string, apiKey: string): string {
  let out = message.replace(/(Subscription-Key=)[^&\s"']+/gi, "$1***");
  if (apiKey) out = out.split(apiKey).join("***");
  return out;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const sec = Number(v);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, RETRY_AFTER_MAX_MS);
  return null;
}

/** EDINET API v2 のクライアントを作る。 */
export function createEdinetClient(apiKey: string, options: EdinetClientOptions = {}): EdinetApi {
  const {
    intervalMs = REQUEST_INTERVAL_MS,
    maxRetries = MAX_RETRIES,
    backoffBaseMs = BACKOFF_BASE_MS,
    timeoutMs = EDINET_TIMEOUT_MS,
    userAgent = EDINET_USER_AGENT,
    // Workers で this が外れて Illegal invocation にならないよう、包んで呼ぶ
    fetchImpl = (input, init) => fetch(input, init),
    sleep = defaultSleep,
    log = console.warn,
  } = options;
  let lastRequestAt = 0;
  let requestCount = 0;

  /** 前のリクエストから intervalMs あけて 1 回投げる。 */
  async function once(url: string): Promise<Response> {
    const wait = lastRequestAt + intervalMs - Date.now();
    if (lastRequestAt > 0 && wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        headers: { "User-Agent": userAgent },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 再試行つきで投げる。label はログ用（URL・キーは含めない）。
   * 404 はそのまま返す（呼び出し側で扱う）。401/403 は EdinetFatalError。
   */
  async function request(url: string, label: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      let reason: string;
      try {
        res = await once(url);
        if (res.status === 401 || res.status === 403) {
          throw new EdinetFatalError(`EDINET ${label}: HTTP ${res.status}（API キーを確認してください）`);
        }
        if (!isRetryableStatus(res.status)) return res;
        reason = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof EdinetFatalError) throw err;
        reason = redactKey((err as Error).message || String(err), apiKey);
      }
      if (attempt >= maxRetries) {
        throw new EdinetRetryExhaustedError(`EDINET ${label}: ${reason}（${maxRetries} 回再試行しても失敗）`);
      }
      const backoff = (res && retryAfterMs(res)) ?? backoffBaseMs * 2 ** attempt;
      log(`EDINET ${label}: ${reason} → ${Math.round(backoff / 1000)} 秒待って再試行（${attempt + 1}/${maxRetries}）`);
      await sleep(backoff);
    }
  }

  const keyParam = `Subscription-Key=${encodeURIComponent(apiKey)}`;

  return {
    get requestCount() {
      return requestCount;
    },

    async listDocuments(date: string): Promise<EdinetDocMeta[]> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日付の形式が違う: ${date}`);
      const label = `書類一覧 ${date}`;
      const res = await request(`${EDINET_API_BASE}/documents.json?date=${date}&type=2&${keyParam}`, label);
      if (!res.ok) throw new EdinetRetryExhaustedError(`EDINET ${label}: HTTP ${res.status}`);
      const json = (await res.json()) as {
        metadata?: { status?: string; message?: string };
        results?: EdinetDocMeta[];
        statusCode?: number;
      };
      // 認証エラーなどは HTTP 200 でも本文の status / statusCode に出ることがある
      const status = json.metadata?.status ?? (json.statusCode !== undefined ? String(json.statusCode) : "200");
      if (status === "401" || status === "403") {
        throw new EdinetFatalError(`EDINET ${label}: status ${status}（API キーを確認してください）`);
      }
      if (status !== "200") {
        throw new EdinetRetryExhaustedError(`EDINET ${label}: status ${status} ${json.metadata?.message ?? ""}`.trim());
      }
      return Array.isArray(json.results) ? json.results : [];
    },

    async fetchCsvZip(docId: string): Promise<Buffer | null> {
      if (!/^[A-Z0-9]{8}$/.test(docId)) throw new Error(`docID の形式が違う: ${docId}`);
      const label = `CSV ${docId}`;
      const res = await request(`${EDINET_API_BASE}/documents/${docId}?type=5&${keyParam}`, label);
      if (res.status === 404) return null;
      if (!res.ok) throw new EdinetRetryExhaustedError(`EDINET ${label}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // 書類が無いときは HTTP 200 で JSON（metadata.status 404 など）が返る
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("json") || buf.subarray(0, 1).toString() === "{") {
        let status = "";
        try {
          const j = JSON.parse(buf.toString("utf-8")) as { metadata?: { status?: string }; statusCode?: number };
          status = j.metadata?.status ?? (j.statusCode !== undefined ? String(j.statusCode) : "");
        } catch {
          status = "";
        }
        if (status === "401" || status === "403") {
          throw new EdinetFatalError(`EDINET ${label}: status ${status}（API キーを確認してください）`);
        }
        if (status === "404") return null;
        throw new EdinetRetryExhaustedError(`EDINET ${label}: ZIP ではない応答（status ${status || "不明"}）`);
      }
      return buf;
    },
  };
}
