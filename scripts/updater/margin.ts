import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { MarginFile } from "../../src/types/margin";
import { buildMarginFile, parseMarginFile, sameMarginContent } from "../../src/lib/margin/file";
import { CACHE_DIR, HTTP_TIMEOUT_MS, JPX_MARGIN_URL, USER_AGENT } from "./config";
import { readJson, writeJsonIfChanged } from "./io";

// margin.json（信用取引残高）の生成。JPX「銘柄別信用取引残高」の PDF を週 1 回〜毎営業日 1 本だけ取る。
// 銘柄別の Excel は 2026 年 9 月の様式変更で無くなり、PDF（YYYYMMDD_mtall.pdf、直近 5 営業日分）だけが公表されている。
// 純関数（行 → MarginFile）は src/lib/margin/file.ts。ここは取得・PDF のテキスト化・書き込み。
// JPX の統計は個人利用の範囲で使い、本人専用アプリの中でだけ使う（再配信しない）。

const BASE_URL = "https://www.jpx.co.jp";

/** ページ HTML から最新の _mtall.pdf のリンク（絶対 URL）と、ファイル名の日付を拾う。 */
export function findLatestPdfUrl(html: string): { url: string; fileDate: string } | null {
  const re = /href="([^"]*\/(\d{8})_mtall\.pdf)"/g;
  let best: { href: string; date: string } | null = null;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!best || m[2] > best.date) best = { href: m[1], date: m[2] };
  }
  if (!best) return null;
  return { url: new URL(best.href, BASE_URL).toString(), fileDate: best.date };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS * 3),
  });
  if (!res.ok) throw new Error(`${url} が HTTP ${res.status}`);
  return res;
}

/** PDF の全ページを、見た目の 1 行ごとのセル配列にする（ページが回転していても表示上の座標で並べる）。 */
export async function pdfToRows(data: Uint8Array): Promise<string[][]> {
  const doc = await getDocument({ data }).promise;
  const rows: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [a, b, c, d, e, f] = page.getViewport({ scale: 1 }).transform;
    const content = await page.getTextContent();
    const cells: { x: number; y: number; s: string }[] = [];
    for (const it of content.items) {
      if (!("str" in it) || it.str.trim() === "") continue;
      const x0 = it.transform[4];
      const y0 = it.transform[5];
      cells.push({ x: a * x0 + c * y0 + e, y: b * x0 + d * y0 + f, s: it.str.trim() });
    }
    // 表示上の y が近いものを同じ行に（行間は約 6、同じ行の揺れは 1 未満）
    cells.sort((p, q) => p.y - q.y || p.x - q.x);
    let cur: typeof cells = [];
    const flush = () => {
      if (cur.length > 0) rows.push(cur.sort((p, q) => p.x - q.x).map((x) => x.s));
      cur = [];
    };
    let lastY = -Infinity;
    for (const cell of cells) {
      if (cur.length > 0 && cell.y - lastY > 1.5) flush();
      cur.push(cell);
      lastY = cell.y;
    }
    flush();
    page.cleanup();
  }
  return rows;
}

export type MarginUpdateStatus = "written" | "unchanged" | "kept";

export interface MarginUpdateResult {
  status: MarginUpdateStatus;
  message: string;
  asOf: string | null;
  count: number;
  sourceUrl: string | null;
}

/** 最新の PDF を取り、keep の銘柄だけ margin.json に書く。失敗時は既存ファイルを残す（例外は投げない）。 */
export async function runMarginUpdate(filePath: string, keep: ReadonlySet<string>, now: Date): Promise<MarginUpdateResult> {
  const kept = (message: string): MarginUpdateResult => ({ status: "kept", message, asOf: null, count: 0, sourceUrl: null });
  try {
    const html = await (await fetchWithTimeout(JPX_MARGIN_URL)).text();
    const latest = findLatestPdfUrl(html);
    if (!latest) return kept("最新の _mtall.pdf のリンクがページに見つからない（ページ様式の変更？）。既存の margin.json を残す");

    const cacheFile = path.join(CACHE_DIR, "margin", `${latest.fileDate}.pdf`);
    let pdf: Uint8Array;
    try {
      pdf = new Uint8Array(await readFile(cacheFile));
    } catch {
      pdf = new Uint8Array(await (await fetchWithTimeout(latest.url)).arrayBuffer());
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, pdf);
    }

    const rows = await pdfToRows(pdf);
    const next = buildMarginFile(rows, latest.url, now, keep);
    if (!next) return kept("PDF から基準日または銘柄行を読めなかった（様式の変更？）。既存の margin.json を残す");
    const count = Object.keys(next.items).length;
    if (count === 0) return kept("対象銘柄が 1 件も見つからなかった。既存の margin.json を残す");

    const current: MarginFile | null = parseMarginFile(await readJson<unknown>(filePath, null));
    if (current && current.asOf > next.asOf) return kept(`既存の基準日 ${current.asOf} のほうが新しい。既存を残す`);
    if (sameMarginContent(current, next)) {
      return { status: "unchanged", message: "内容に変更なし", asOf: next.asOf, count, sourceUrl: latest.url };
    }
    await writeJsonIfChanged(filePath, next);
    return { status: "written", message: "margin.json を更新", asOf: next.asOf, count, sourceUrl: latest.url };
  } catch (err) {
    return kept(`取得に失敗（${(err as Error).message}）。既存の margin.json を残す`);
  }
}
