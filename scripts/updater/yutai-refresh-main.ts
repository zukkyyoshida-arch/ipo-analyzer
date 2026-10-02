import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { YutaiIndexFile, YutaiMonthFile } from "../../src/lib/yutai/types";
import { parseYutaiMonthFile } from "../../src/lib/yutai/file";
import { FILES } from "./config";
import { readJson } from "./io";
import { dailyIndicators, toDailyBars } from "./yutai-daily";
import { applyExternal, applyIndicators, targetMonths } from "./yutai-external";
import { limitFromEnv, loadExternalData } from "./yutai-external-fetch";
import { jstDateIso, serializeYutaiIndexFile, serializeYutaiMonthFile, sameExceptGeneratedAt } from "./yutai";
import { sleep, EXTERNAL_INTERVAL_MS } from "./yutai-cache";
import YahooFinance from "yahoo-finance2";

// 優待データの日次更新。実行: npm run yutai:refresh （-- --dry-run で書き込まない）
// yutai:data は月 1 回しか実処理しないので、権利月が近い今月＋1・今月＋2 の月別ファイルだけ、毎晩次を直す。
//   1. 現在値まわり（price/priceAsOf/high12/low12/ma25/ma75/low1m/ret1m）: Yahoo の日足を直近 300 営業日ぶん取り直す
//      （約 450 暦日。1 銘柄 1 リクエスト・1 秒間隔）→ dailyIndicators で更新
//   2. 週 1 回（キャッシュ 6 日）: 決算発表予定日（JPX → Yahoo）と直近決算を取り直し、除外ルールを再適用
//      （除外した銘柄は excludedItems に積み増すだけで、一度除外した銘柄は items に戻さない。戻るのは月初の yutai:data で組み直したとき）
// 件数を絞る動作確認: YUTAI_LIMIT=3 npm run yutai:refresh -- --dry-run

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const dryRun = process.argv.includes("--dry-run");
const REFRESH_BARS = 300;

async function fetchRecentDaily(code: string, now: Date) {
  const period1 = new Date(now.getTime() - 450 * 86_400_000);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(3000 * attempt);
    try {
      const chart = await yf.chart(`${code}.T`, { period1, period2: now, interval: "1d" });
      return chart.quotes.map((q) => ({ date: q.date, open: q.open, high: q.high, low: q.low, close: q.close, adjclose: q.adjclose }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const started = Date.now();
  const now = new Date();
  const todayIso = jstDateIso(now);
  const months = targetMonths(todayIso);
  console.log(`yutai:refresh 開始（${todayIso}・対象 ${months.join("・")} 月${dryRun ? "・dry-run" : ""}）`);

  const files = new Map<number, YutaiMonthFile>();
  for (const m of months) {
    const raw = await readJson<unknown>(path.join(FILES.yutaiDir, `${m}.json`), null);
    const parsed = parseYutaiMonthFile(raw);
    if (!parsed) {
      console.warn(`  ${m} 月のファイルを読めないためスキップ`);
      continue;
    }
    files.set(m, parsed);
  }
  if (files.size === 0) {
    console.log("対象の月別ファイルが無いので終了");
    return;
  }

  // 1. 現在値まわり
  const codes = [...new Set([...files.values()].flatMap((f) => f.items.map((it) => it.code)))].sort();
  const limit = limitFromEnv();
  const dailyCodes = limit ? codes.slice(0, limit) : codes;
  console.log(`日足を取り直します（${dailyCodes.length}/${codes.length} 銘柄・1 秒間隔）`);
  const indicators = new Map<string, ReturnType<typeof dailyIndicators>>();
  let failed = 0;
  for (let i = 0; i < dailyCodes.length; i++) {
    try {
      const bars = toDailyBars(await fetchRecentDaily(dailyCodes[i], now)).slice(-REFRESH_BARS);
      indicators.set(dailyCodes[i], dailyIndicators(bars));
    } catch (err) {
      failed++;
      console.warn(`  日足を取れずスキップ: ${dailyCodes[i]} — ${(err as Error).message}`);
    }
    await sleep(EXTERNAL_INTERVAL_MS);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${dailyCodes.length}（失敗 ${failed}）`);
  }

  // 2. 決算発表予定日・直近決算（キャッシュが 6 日以内なら通信しない）
  const targetItems = [...files.values()].flatMap((f) => f.items);
  const ext = await loadExternalData(now, { detailItems: null, targetItems, profit: true });

  const generatedAt = now.toISOString();
  let written = 0;
  for (const [m, file] of files) {
    const withInd = { ...file, items: file.items.map((it) => {
      const ind = indicators.get(it.code);
      return ind ? applyIndicators(it, ind) : it;
    }) };
    const next = applyExternal(withInd, ext, todayIso);
    const out: YutaiMonthFile = { ...next, asOf: file.asOf, generatedAt };
    const text = serializeYutaiMonthFile(out);
    const p = path.join(FILES.yutaiDir, `${m}.json`);
    const current = await readFile(p, "utf-8").catch(() => null);
    const changed = !sameExceptGeneratedAt(current, JSON.parse(text) as YutaiMonthFile);
    console.log(
      `  ${m} 月: items ${file.items.length} → ${out.items.length}（除外 決算 ${out.excludedEarnings ?? 0}・廃止 ${out.excludedAbolished ?? 0}）${changed ? "・更新あり" : "・変更なし"}`,
    );
    if (changed && !dryRun) {
      await writeFile(p, text, "utf-8");
      written++;
    }
  }

  // index.json: 件数と generatedAt（asOf は月初の一覧を取った日のまま）
  if (written > 0 && !dryRun) {
    const indexPath = path.join(FILES.yutaiDir, "index.json");
    const index = await readJson<YutaiIndexFile | null>(indexPath, null);
    if (index) {
      index.generatedAt = generatedAt;
      for (const [m] of files) {
        const f = parseYutaiMonthFile(await readJson<unknown>(path.join(FILES.yutaiDir, `${m}.json`), null));
        if (f && index.months[String(m)]) index.months[String(m)].itemCount = f.items.length;
      }
      await writeFile(indexPath, serializeYutaiIndexFile(index), "utf-8");
    }
  }
  console.log(`yutai:refresh 終了（書き込み ${written} ファイル・所要 ${Math.round((Date.now() - started) / 1000)} 秒）`);
}

main().catch((err) => {
  console.error("yutai:refresh 実行中に致命的エラー:", (err as Error).message);
  process.exitCode = 1;
});
