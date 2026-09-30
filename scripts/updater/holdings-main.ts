import type { IpoAuto, IpoBase } from "../../src/types/data";
import { jstTodayIso } from "../../src/lib/date";
import { FILES } from "./config";
import { readJson } from "./io";
import { HOLDINGS_MAX_CSV_PER_RUN, HOLDINGS_MAX_LIST_REQUESTS, runHoldingsUpdate } from "./holdings";

// 大量保有報告書（public/data/holdings.json）だけを作り直す。
// 実行: npm run holdings:data （-- --max-csv 1000 のように上限を変えられる）
// update:data（夜間ジョブ）でも同じ処理が走る。こちらは Yahoo・JPX を叩かずに holdings だけ試したいとき用。
// ipos.auto.json・market.json などは書かない（largeHoldingReport の反映は update:data の役目）。
//
// オプション:
//   --max-csv N        1 回に取る CSV の上限（既定 HOLDINGS_MAX_CSV_PER_RUN）
//   --max-list N       1 回に取る書類一覧の上限（既定 HOLDINGS_MAX_LIST_REQUESTS）
//   --backfill-days N  遡る日数（既定 180。holdings.json に残す日数も同じ）

function numArg(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} には正の数を指定してください`);
  return Math.floor(v);
}

async function main(): Promise<void> {
  const base = await readJson<IpoBase[]>(FILES.base, []);
  const auto = await readJson<IpoAuto[]>(FILES.auto, []);
  const today = jstTodayIso();
  const maxCsvDownloads = numArg("--max-csv") ?? HOLDINGS_MAX_CSV_PER_RUN;
  const maxListRequests = numArg("--max-list") ?? HOLDINGS_MAX_LIST_REQUESTS;
  const backfillDays = numArg("--backfill-days");

  console.log(`holdings:data 開始（今日 ${today}・CSV 上限 ${maxCsvDownloads}・一覧上限 ${maxListRequests}）`);
  const result = await runHoldingsUpdate({
    base,
    auto,
    today,
    maxCsvDownloads,
    maxListRequests,
    backfillDays,
  });
  console.log("=== holdings:data サマリ ===");
  console.log(`状態: ${result.status}`);
  console.log(result.message);
  console.log(`holdings.json 書き込み: ${result.written ? "あり" : "なし"}`);
  console.log(`EDINET へのリクエスト: ${result.requests} 本・所要 ${Math.round(result.durationMs / 1000)} 秒`);
  if (result.status === "partial") process.exitCode = 2;
}

main().catch((err) => {
  console.error("holdings:data 実行中に致命的エラー:", (err as Error).message);
  process.exitCode = 1;
});
