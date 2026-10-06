import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseYutaiMonthFile } from "../../src/lib/yutai/file";
import type { YutaiItem, YutaiMonthFile } from "../../src/lib/yutai/types";
import {
  median,
  PICK_LIMIT_PER_MONTH,
  PICKS_NOTE,
  ruleMatches,
  selectPicks,
  summarizeHistory,
  targetPickMonths,
  type PickItem,
  type PickMonth,
  type PicksFile,
} from "../../src/lib/yutai/picksRules";
import { FILES } from "./config";
import { readJson } from "./io";
import { jstDateIso, sameExceptGeneratedAt } from "./yutai";

// 優待先回り買いの「検証ルールの候補」を作る。実行: npm run yutai:picks （-- --dry-run で書き込まない）
// 検証済みのルール（scripts/backtest/yutai/REPORT.md）が今日どの銘柄を選ぶかを public/data/yutai/picks.json に書く。
//   1. 権利付最終日までの営業日数 e が 30〜90 の権利月を対象にする（src/lib/yutai/picksRules.ts の targetPickMonths）
//   2. 日足キャッシュ（scripts/updater/.cache/yutai-daily/。M1 の夜間ジョブが月 1 回更新）から
//      「e 営業日前に買い、権利付最終日の大引けで売る」の同月の過去成績を銘柄ごとに集計（2016 年以降）
//   3. 月別ファイル（public/data/yutai/<M>.json）の今日の株価・75 日線などと合わせてルール B/C/D を判定し、上位 15 件
// 外部への通信はしない。日付を固定する: YUTAI_PICKS_TODAY=2026-10-06 npm run yutai:picks -- --dry-run

const dryRun = process.argv.includes("--dry-run");
const DAILY_DIR = path.join(process.cwd(), "scripts/updater/.cache/yutai-daily");
const PICKS_PATH = path.join(FILES.yutaiDir, "picks.json");
const FROM_YEAR = 2016;

function todayFromEnv(now: Date): string {
  const fixed = process.env.YUTAI_PICKS_TODAY;
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  return jstDateIso(now);
}

function pct(ratio: number | null): string {
  if (ratio === null) return "—";
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** 比率を小数 4 桁に丸める（picks.json を小さく保つ）。 */
function r4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** 月別ファイルの銘柄 1 件と過去成績から候補を作る。株価が無ければ null。 */
function toPickItem(it: YutaiItem, hist: NonNullable<ReturnType<typeof summarizeHistory>>): PickItem | null {
  if (it.price === null || !(it.price > 0)) return null;
  const ma75 = it.ma75 ?? null;
  const pos12 =
    it.high12 !== null && it.low12 !== null && it.high12 > it.low12 ? (it.price - it.low12) / (it.high12 - it.low12) : null;
  return {
    code: it.code,
    name: it.name,
    ...hist,
    avg: r4(hist.avg),
    worst: r4(hist.worst),
    price: it.price,
    priceAsOf: it.priceAsOf ?? null,
    invest: it.price * 100,
    minInvest: it.minInvest,
    aboveMa75: ma75 !== null ? it.price > ma75 : null,
    pos12: pos12 === null ? null : r4(pos12),
    ret1m: it.ret1m == null ? null : r4(it.ret1m),
    sector: it.sector ?? null,
    nextEarningsDate: it.nextEarningsDate ?? null,
    detailUrl: it.detailUrl || null,
    rules: [],
  };
}

async function main(): Promise<void> {
  const started = Date.now();
  const now = new Date();
  const todayIso = todayFromEnv(now);
  const targets = targetPickMonths(todayIso);
  console.log(
    `yutai:picks 開始（${todayIso}・対象 ${targets.map((t) => `${t.month} 月（${t.entryDays} 営業日前）`).join("・") || "なし"}${dryRun ? "・dry-run" : ""}）`,
  );
  if (targets.length === 0) {
    console.log("対象の権利月が無いので終了");
    return;
  }
  if (!existsSync(DAILY_DIR) || readdirSync(DAILY_DIR).length === 0) {
    console.log(`日足キャッシュが無いので終了（${DAILY_DIR}。npm run yutai:data で作られる）`);
    return;
  }

  const files = new Map<number, YutaiMonthFile>();
  for (const t of targets) {
    const parsed = parseYutaiMonthFile(await readJson<unknown>(path.join(FILES.yutaiDir, `${t.month}.json`), null));
    if (!parsed) {
      console.warn(`  ${t.month} 月のファイルを読めないためスキップ`);
      continue;
    }
    files.set(t.month, parsed);
  }
  if (files.size === 0) {
    console.log("対象の月別ファイルが無いので終了");
    return;
  }

  // 市場条件: 対象月の優待銘柄（重複は 1 回）の直近 1 か月の騰落率の中央値
  const byCode = new Map<string, YutaiItem>();
  for (const f of files.values()) for (const it of f.items) if (!byCode.has(it.code)) byCode.set(it.code, it);
  const marketRet1m = median([...byCode.values()].map((it) => it.ret1m ?? null));
  const marketDown = marketRet1m !== null && marketRet1m <= 0;
  console.log(`市場条件: 優待銘柄 ${byCode.size} 社の直近1か月の中央値 ${pct(marketRet1m)} → ${marketDown ? "成立" : "不成立"}`);

  // 日足キャッシュを読む（数十秒）。import の時点で全銘柄の日足を読み込むので、ここで初めて読む。
  console.log("日足キャッシュを読み込みます");
  const engine = await import("../backtest/yutai/engine.mts");
  console.log(`  ${engine.universe().stocks} 銘柄・${engine.universe().days} 営業日（${Math.round((Date.now() - started) / 1000)} 秒）`);

  const months: PickMonth[] = [];
  for (const t of targets) {
    const file = files.get(t.month);
    if (!file) continue;
    const hist = new Map<string, { year: number; ret: number }[]>();
    for (const tr of engine.buildTrades(t.entryDays, 0)) {
      if (tr.month !== t.month || tr.year < FROM_YEAR) continue;
      (hist.get(tr.code) ?? hist.set(tr.code, []).get(tr.code)!).push({ year: tr.year, ret: tr.ret });
    }
    const candidates: PickItem[] = [];
    for (const it of file.items) {
      if (it.yutaiStatus === "abolished") continue;
      const sum = summarizeHistory(hist.get(it.code) ?? []);
      if (!sum) continue;
      const p = toPickItem(it, sum);
      if (p) candidates.push(p);
    }
    const selected = selectPicks(candidates, marketDown);
    const items = selected.slice(0, PICK_LIMIT_PER_MONTH);
    months.push({ month: t.month, year: t.year, lastCumDate: t.lastCumDate, entryDays: t.entryDays, matched: selected.length, items });
    const count = (r: "B" | "C" | "D") => candidates.filter((c) => ruleMatches(c, marketDown).includes(r)).length;
    console.log(
      `  ${t.month} 月（権利付最終日 ${t.lastCumDate}・${t.entryDays} 営業日前）: 成績あり ${candidates.length} 社・該当 ${selected.length} 社（B ${count("B")}・C ${count("C")}・D ${count("D")}）`,
    );
    for (const p of items.slice(0, 3)) {
      console.log(
        `    ${p.code} ${p.name} ${p.win}/${p.n}勝 平均${pct(p.avg)} 最悪${pct(p.worst)} 100株${Math.round(p.invest / 1000) / 10}万 [${p.rules.join("")}]`,
      );
    }
  }

  const out: PicksFile = {
    generatedAt: now.toISOString(),
    asOf: todayIso,
    marketRet1m: marketRet1m === null ? null : r4(marketRet1m),
    marketDown,
    months,
    note: { ...PICKS_NOTE },
  };
  const text = `${JSON.stringify(out, null, 1)}\n`;
  const current = await readFile(PICKS_PATH, "utf-8").catch(() => null);
  const changed = !sameExceptGeneratedAt(current, JSON.parse(text) as PicksFile);
  if (changed && !dryRun) await writeFile(PICKS_PATH, text, "utf-8");
  console.log(
    `yutai:picks 終了（${changed ? (dryRun ? "更新あり・dry-run のため書かない" : "picks.json を更新") : "変更なし"}・所要 ${Math.round((Date.now() - started) / 1000)} 秒）`,
  );
}

main().catch((err) => {
  console.error("yutai:picks 実行中に致命的エラー:", (err as Error).message);
  process.exitCode = 1;
});
