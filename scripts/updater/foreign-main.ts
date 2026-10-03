import type { IpoAuto, IpoBase } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import { jstTodayIso } from "../../src/lib/date";
import { mergeIpos } from "../../src/lib/merge";
import { normalizeCode } from "../../src/lib/margin/file";
import { FILES } from "./config";
import { FOREIGN_MAX_DAYS, runForeignUpdate } from "./foreign";
import { readJson } from "./io";

// 外国法人等の持株比率（public/data/foreign.json）を 1 回分進める。
// 実行: npm run foreign:data
// 対象は ipos.base.json + ipos.auto.json（+ ipos.enriched.json）を合成した全銘柄（上場日では絞らない）。
// 失敗しても既存の foreign.json を残し、警告ログだけで正常終了する（夜間ジョブを止めない）。
//
// 環境変数:
//   FOREIGN_MAX_DAYS  1 回に走査する日数（既定 120）
//   FOREIGN_FROM      走査を始める日 YYYY-MM-DD（確認用。scannedThrough より先へ飛んだときは scannedThrough を進めない）

function maxDaysFromEnv(): number {
  const raw = process.env.FOREIGN_MAX_DAYS;
  if (!raw) return FOREIGN_MAX_DAYS;
  const v = Math.floor(Number(raw));
  if (!Number.isFinite(v) || v <= 0) {
    console.warn(`[warn] FOREIGN_MAX_DAYS が正の数でないので既定の ${FOREIGN_MAX_DAYS} 日にする`);
    return FOREIGN_MAX_DAYS;
  }
  return v;
}

function fromEnv(): string | undefined {
  const raw = process.env.FOREIGN_FROM?.trim();
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    console.warn(`[warn] FOREIGN_FROM は YYYY-MM-DD で指定してください（無視する）`);
    return undefined;
  }
  return raw;
}

async function main(): Promise<void> {
  const base = await readJson<IpoBase[]>(FILES.base, []);
  const auto = await readJson<IpoAuto[]>(FILES.auto, []);
  const enriched = await readJson<IpoEnriched[]>(FILES.enriched, []);
  const ipos = mergeIpos(base, auto, Array.isArray(enriched) ? enriched : []);
  const targetCodes = new Set<string>();
  for (const ipo of ipos) {
    const code = normalizeCode(ipo.code);
    if (code) targetCodes.add(code);
  }
  const today = jstTodayIso();
  const maxDays = maxDaysFromEnv();
  const from = fromEnv();
  console.log(
    `foreign:data 開始（今日 ${today}・対象 ${targetCodes.size} 銘柄・最大 ${maxDays} 日${from ? `・開始日 ${from}` : ""}）`,
  );
  const result = await runForeignUpdate({ targetCodes, today, maxDays, from });
  if (result.status === "skipped") {
    console.warn(`[warn] foreign:data: ${result.message}`);
    return;
  }
  const line = `foreign:data: ${result.message}（書き込み ${result.written ? "あり" : "なし"}・EDINET ${result.requests} 本・${Math.round(result.durationMs / 1000)} 秒）`;
  if (result.status === "partial") console.warn(`[warn] ${line}`);
  else console.log(line);
}

main().catch((err) => {
  const key = process.env.EDINET_API_KEY ?? "";
  const msg = (err as Error)?.message ?? String(err);
  console.warn("[warn] foreign:data 実行中にエラー（既存ファイルは残す）:", key ? msg.split(key).join("***") : msg);
});
