import { existsSync } from "node:fs";
import path from "node:path";
import type { IpoAuto, IpoBase } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import { mergeIpos } from "../../src/lib/merge";
import { addDaysIso, jstTodayIso } from "../../src/lib/date";
import { FILES, REPO_ROOT } from "./config";
import { readJson } from "./io";
import {
  FINS_DELAY_DAYS,
  buildFinsFile,
  fetchAndCache,
  listCachedDates,
  planFetchDates,
  readAllCachedRows,
  seedCacheFromJsonl,
  writeFinsFile,
} from "./fins";

// J-Quants 財務サマリを取り込んで public/data/fins.json を作る。
// 実行: npm run fins:data [-- --max-days 60] [-- --seed <jsonl>]
//   - キャッシュ（scripts/updater/.cache/fins/<日付>.json）の最新日の翌平日〜(今日 − 84 日) を取得する
//   - 初回は --seed の jsonl（1 行 1 JSON の財務サマリ）を日付ごとに分割してキャッシュへ入れる
//   - JQUANTS_API_KEY が無ければ取得をスキップし、キャッシュだけで fins.json を作る

// シード既定: このリポジトリの scratch/、無ければ（git worktree のとき）本体リポジトリの scratch/
const SEED_REL = ["scratch", "backtest", "data", "jquants", "fins_summary.jsonl"];
const DEFAULT_SEEDS = [
  path.join(REPO_ROOT, ...SEED_REL),
  path.resolve(REPO_ROOT, "..", "..", "..", ...SEED_REL),
];

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main(): Promise<void> {
  const maxDaysArg = Number(argValue("--max-days") ?? 60);
  const maxDays = Number.isFinite(maxDaysArg) && maxDaysArg > 0 ? Math.floor(maxDaysArg) : 60;
  const seedPath = argValue("--seed") ?? DEFAULT_SEEDS.find((p) => existsSync(p)) ?? DEFAULT_SEEDS[0];
  const today = jstTodayIso();
  const cutoff = addDaysIso(today, -FINS_DELAY_DAYS);

  const cachedBefore = await listCachedDates();
  if (cachedBefore.length === 0) {
    const seeded = await seedCacheFromJsonl(seedPath);
    console.log(`シード: ${seeded} 日ぶんをキャッシュへ取り込み（${seedPath}）`);
  }

  const apiKey = process.env.JQUANTS_API_KEY;
  let fetchedDays = 0;
  let fetchedRows = 0;
  if (!apiKey) {
    console.log("JQUANTS_API_KEY が無いため取得をスキップ（キャッシュだけで作る）");
  } else {
    const cached = await listCachedDates();
    const dates = planFetchDates(cached.at(-1) ?? null, cutoff, maxDays);
    console.log(`取得予定: ${dates.length} 日（${dates[0] ?? "-"}〜${dates.at(-1) ?? "-"}、上限 ${maxDays} 日）`);
    const s = await fetchAndCache(dates, apiKey);
    fetchedDays = s.days;
    fetchedRows = s.rows;
    if (s.error) console.error(`取得を途中で中断: ${s.error}（取得済みの分は保存済み）`);
  }

  const base = await readJson<IpoBase[]>(FILES.base, []);
  const auto = await readJson<IpoAuto[]>(FILES.auto, []);
  const enriched = await readJson<IpoEnriched[]>(FILES.enriched, []);
  const ipos = mergeIpos(
    Array.isArray(base) ? base : [],
    Array.isArray(auto) ? auto : [],
    Array.isArray(enriched) ? enriched : [],
  );
  const codes = new Set(ipos.map((i) => i.code));

  const rows = await readAllCachedRows();
  const file = buildFinsFile(rows, codes, new Date().toISOString());
  const written = await writeFinsFile(FILES.fins, file);

  const items = Object.values(file.items);
  const withFy = items.filter((i) => i.fy).length;
  const withQ = items.filter((i) => i.latestQuarter).length;
  console.log(
    `fins: 取得 ${fetchedDays} 日・${fetchedRows} 行 / キャッシュ ${rows.length} 行 / 対象コード ${codes.size} / ` +
      `fins.json ${items.length} 件（fy ${withFy}・四半期 ${withQ}）asOf=${file.asOf} ${written ? "書き込み" : "変更なし"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
