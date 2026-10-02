import { readZipEntries } from "./zip";
import { HTTP_TIMEOUT_MS, USER_AGENT } from "./config";
import { decodeHtmlEntities } from "./yutai";

// 決算発表予定日。主ソースは JPX「決算発表予定日」ページ（上場会社の決算の発表予定会社一覧の xlsx）。
//   https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html
// ページには xlsx が並ぶ: 翌営業日分（kessan.xlsx）と、四半期末・期末を迎えた月ごとの一覧（kessan09_1002.xlsx など。
// 期末の翌月上旬に出て、その後更新される）。列は A 発表予定日（Excel の日付シリアル）/ B コード / C 会社名 / F 業種名 / H 種別。
// 取れない銘柄（まだ一覧が出ていない月の期末など）は yahoo-finance2 の calendarEvents で補う（yutai-external.ts の呼び出し側）。
// xlsx は依存を増やさず、zip 展開（./zip）と XML の最小パースで読む。

export const JPX_EARNINGS_PAGE_URL = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html";
const JPX_ORIGIN = "https://www.jpx.co.jp";

export interface EarningsRow {
  code: string;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** 33 業種名 */
  sector: string;
  /** 種別（例: 第２四半期） */
  kind: string;
}

/** ページの HTML から xlsx へのリンク（絶対 URL）を重複なく取る。 */
export function parseEarningsXlsxLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="([^"]+\.xlsx)"/g)) {
    const u = new URL(decodeHtmlEntities(m[1]), JPX_ORIGIN + "/listing/event-schedules/financial-announcement/index.html").href;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Excel の日付シリアル（1900 年系）→ YYYY-MM-DD。整数でなければ null。 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** 全角の英数字を半角にする（「３９４３」「１３０Ａ」）。 */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeHtmlEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
}

/** xlsx（Buffer）の 1 枚目のシートから決算発表予定の行を読む。壊れていれば例外。 */
export function parseEarningsXlsx(buf: Buffer): EarningsRow[] {
  const entries = readZipEntries(buf);
  const find = (name: string) => entries.find((e) => e.name === name)?.data.toString("utf-8");
  const sheet = find("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("xlsx に sheet1 が無い");
  const strings = parseSharedStrings(find("xl/sharedStrings.xml") ?? "");
  const rows: EarningsRow[] = [];
  for (const rm of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = cm[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v === undefined) continue;
      cells[cm[1]] = /t="s"/.test(cm[2]) ? (strings[Number(v)] ?? "") : v;
    }
    if (!cells.A || !cells.B || !/^\d+(\.\d+)?$/.test(cells.A.trim())) continue;
    const date = excelSerialToIso(Number(cells.A));
    const code = toHalfWidth(cells.B.trim()).toUpperCase();
    if (!date || !/^\d{3}[0-9A-Z]$/.test(code)) continue;
    rows.push({
      code,
      date,
      name: (cells.C ?? "").trim(),
      sector: (cells.F ?? "").trim(),
      kind: (cells.H ?? "").trim(),
    });
  }
  return rows;
}

/** 銘柄ごとの次の発表予定日（todayIso 以降で最も早い日）。同じ銘柄が複数の一覧にあってもよい。 */
export function nextEarningsByCode(rows: EarningsRow[], todayIso: string): Map<string, string> {
  const best = new Map<string, string>();
  for (const r of rows) {
    if (r.date < todayIso) continue;
    const cur = best.get(r.code);
    if (!cur || r.date < cur) best.set(r.code, r.date);
  }
  return best;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS * 2) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** JPX のページから xlsx を全部取って、行をまとめて返す（xlsx 間は 1 秒あける）。取れた xlsx が 0 本なら例外。 */
export async function fetchJpxEarningsRows(): Promise<{ rows: EarningsRow[]; files: number }> {
  const res = await fetch(JPX_EARNINGS_PAGE_URL, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`JPX 決算発表予定日ページ HTTP ${res.status}`);
  const links = parseEarningsXlsxLinks(await res.text());
  const rows: EarningsRow[] = [];
  let files = 0;
  for (const url of links) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      rows.push(...parseEarningsXlsx(await fetchBuffer(url)));
      files++;
    } catch (err) {
      console.warn(`  決算発表予定日の xlsx を読めずスキップ: ${url} — ${(err as Error).message}`);
    }
  }
  if (files === 0) throw new Error("決算発表予定日の xlsx を 1 本も読めなかった");
  return { rows, files };
}
