// 優待先回り買いのバックテスト。夜間ジョブが更新する日足キャッシュと優待メタ（public/data/yutai）から全トレードを生成し、条件ごとの勝率を出す。
// 実行: npx tsx scripts/backtest/yutai/<script>.mts（REPORT.md に結果の要約、LOSS_REASONS.md に負け年の調査）
// 権利付最終日: 月末最終営業日の 2 営業日前（2019-07-16 より前は 3 営業日前）。営業日は全銘柄の日足の和集合で判定。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// リポジトリルート。日足は夜間ジョブ（M1）が月1回更新する scripts/updater/.cache/yutai-daily/ を読む（別取得はしない）。
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DAILY_DIR = path.join(ROOT, "scripts/updater/.cache/yutai-daily");
const YUTAI_DIR = path.join(ROOT, "public/data/yutai");
export const meta: Record<string, any> = {};
for (const f of fs.readdirSync(YUTAI_DIR).filter((f) => /^\d+\.json$/.test(f))) {
  const m = Number(f.replace(".json", ""));
  for (const it of JSON.parse(fs.readFileSync(path.join(YUTAI_DIR, f), "utf8")).items) {
    const e = (meta[it.code] ??= { code: it.code, name: it.name, months: [] as number[], minInvest: it.minInvest, sector: it.sector ?? null, nextEarningsDate: it.nextEarningsDate ?? null, yutaiStatus: it.yutaiStatus ?? null, n10: it.n10 });
    e.months.push(m);
  }
}
type Bar = [string, number, number, number, number, number];
const bars: Record<string, Bar[]> = {};
const daySet = new Set<string>();
export function loadBars(code: string): Bar[] | null {
  const f = path.join(DAILY_DIR, `${code}.json`);
  if (!fs.existsSync(f)) return null;
  const q: any[] = JSON.parse(fs.readFileSync(f, "utf8")).quotes ?? [];
  return q.filter((r) => r.open != null && r.high != null && r.low != null && r.close != null)
    .map((r) => [String(r.date).slice(0, 10), r.open, r.high, r.low, r.close, r.volume ?? 0] as Bar);
}
for (const code of Object.keys(meta)) {
  const b = loadBars(code);
  if (!b || b.length < 300) continue;
  bars[code] = b;
  for (const r of b) daySet.add(r[0]);
}
const days = [...daySet].sort();
const dayIdx = new Map(days.map((d, i) => [d, i]));
// 既存キャッシュは約10年分（2015年11月〜）。トレードは 2016 年から
const YEARS = Array.from({ length: 11 }, (_, i) => 2016 + i);
function lastCum(year: number, month: number): string | null {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  let last = -1;
  for (let i = days.length - 1; i >= 0; i--) if (days[i].startsWith(ym)) { last = i; break; }
  if (last < 0) return null;
  const back = days[last] < "2019-07-16" ? 3 : 2;
  return days[last - back] ?? null;
}
export interface Trade {
  code: string; month: number; year: number;
  entryDate: string; exitDate: string; ret: number;
  // 特徴量（エントリー時点で分かるものだけ）
  invest: number; pos12: number | null; aboveMa75: boolean | null; ret1m: number | null; ret3m: number | null;
  trailN: number; trailWin: number; trailAvg: number | null; // 同じ戦略の過去年の成績（当年を含まない）
  sector: string | null; crowd: number; // crowd = その権利月の銘柄数
  mktRet1m: number | null; // 日経の代わりに全銘柄平均の直近1か月（等金額）
}
export interface Opts { stopLoss?: number | null; exitMode?: "beforeLastCum" | "exDayOpen"; control?: boolean }
export function buildTrades(entryBefore: number, exitBefore: number, entryMode: "days" | "monthStart" = "days", monthsBefore = 1, opts: Opts = {}): Trade[] {
  const stopLoss = opts.stopLoss ?? null; const exitMode = opts.exitMode ?? "beforeLastCum"; const control = opts.control ?? false;
  const out: Trade[] = [];
  const crowd: Record<number, number> = {};
  for (const m of Object.values(meta) as any[]) for (const mo of m.months) crowd[mo] = (crowd[mo] ?? 0) + 1;
  for (const [code, b] of Object.entries(bars)) {
    const m = meta[code];
    const byDate = new Map(b.map((r, i) => [r[0], i]));
    const idxOnOrAfter = (d: string) => { let lo = 0, hi = b.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid][0] < d) lo = mid + 1; else hi = mid; } return lo; };
    const idxOnOrBefore = (d: string) => { const i = idxOnOrAfter(d); return i < b.length && b[i][0] === d ? i : i - 1; };
    for (const month0 of m.months) {
      // 対照: 権利月を 6 か月ずらした「優待需給の無い」同じ長さの窓（その月も権利月なら飛ばす）
      let month = month0; if (control) { month = ((month0 + 5) % 12) + 1; if (m.months.includes(month)) continue; }
      const hist: { year: number; ret: number }[] = [];
      for (const year of YEARS) {
        const lc = lastCum(year, month); if (!lc) continue;
        const lcI = dayIdx.get(lc)!;
        const exitDay = days[lcI - exitBefore]; if (!exitDay) continue;
        let entryDay: string;
        if (entryMode === "days") entryDay = days[lcI - entryBefore];
        else { // 権利月の monthsBefore か月前の月初営業日
          let y = year, mo = month - monthsBefore; while (mo <= 0) { mo += 12; y--; }
          const ym = `${y}-${String(mo).padStart(2, "0")}`; entryDay = days.find((d) => d.startsWith(ym))!;
        }
        if (!entryDay) continue;
        const ei = idxOnOrAfter(entryDay), xi = idxOnOrBefore(exitDay);
        if (ei >= b.length || xi < 0 || xi <= ei) continue;
        if (b[ei][0] > days[Math.min(days.length - 1, dayIdx.get(entryDay)! + 3)]) continue; // 当時まだ上場していない
        if (ei < 260) { /* 上場1年未満でも可だが特徴量は欠ける */ }
        const entry = b[ei][1];
        let exitI = xi, exit = b[xi][4];
        if (exitMode === "exDayOpen") { if (xi + 1 >= b.length) continue; exitI = xi + 1; exit = b[xi + 1][1]; }
        if (!(entry > 0) || !(exit > 0)) continue;
        if (stopLoss !== null) { for (let k = ei; k < exitI; k++) if (b[k][4] / entry - 1 <= stopLoss) { exit = b[Math.min(k + 1, exitI)][1]; exitI = k + 1; break; } }
        const ret = exit / entry - 1;
        if (ret > 1.5 || ret < -0.8 || entry < 10) continue; // 分割未調整などの異常データを除外
        // 特徴量
        const w = b.slice(Math.max(0, ei - 250), ei);
        const hi = w.length ? Math.max(...w.map((r) => r[2])) : null, lo = w.length ? Math.min(...w.map((r) => r[3])) : null;
        const pos12 = hi !== null && lo !== null && hi > lo ? (b[ei - 1][4] - lo) / (hi - lo) : null;
        const w75 = b.slice(Math.max(0, ei - 75), ei);
        const ma75 = w75.length === 75 ? w75.reduce((s, r) => s + r[4], 0) / 75 : null;
        const prev = b[ei - 1]?.[4] ?? null;
        const ret1m = ei >= 21 && prev ? prev / b[ei - 21][4] - 1 : null;
        const ret3m = ei >= 63 && prev ? prev / b[ei - 63][4] - 1 : null;
        const trail = hist.filter((h) => h.year < year);
        out.push({
          code, month, year, entryDate: b[ei][0], exitDate: b[exitI][0], ret,
          invest: entry * 100, pos12, aboveMa75: ma75 !== null && prev !== null ? prev > ma75 : null, ret1m, ret3m,
          trailN: trail.length, trailWin: trail.filter((h) => h.ret > 0).length, trailAvg: trail.length ? trail.reduce((s, h) => s + h.ret, 0) / trail.length : null,
          sector: m.sector, crowd: crowd[month], mktRet1m: null,
        });
        hist.push({ year, ret });
      }
    }
  }
  // 市場の直近1か月: 同じ日に入った全トレードの ret1m の中央値で代用
  const byDay = new Map<string, number[]>();
  for (const t of out) if (t.ret1m !== null) (byDay.get(t.entryDate) ?? byDay.set(t.entryDate, []).get(t.entryDate)!).push(t.ret1m);
  for (const t of out) { const a = byDay.get(t.entryDate); if (a && a.length >= 20) { const s = [...a].sort((x, y) => x - y); t.mktRet1m = s[s.length >> 1]; } }
  return out;
}
export function stat(ts: Trade[]) {
  const n = ts.length; if (!n) return { n: 0, win: 0, avg: null as number | null, med: null as number | null, p10: null as number | null, years: 0, yearWin: 0 };
  const w = ts.filter((t) => t.ret > 0).length;
  const s = ts.map((t) => t.ret).sort((a, b) => a - b);
  const byYear = new Map<number, number[]>();
  for (const t of ts) (byYear.get(t.year) ?? byYear.set(t.year, []).get(t.year)!).push(t.ret);
  let yearWin = 0; for (const a of byYear.values()) if (a.reduce((x, y) => x + y, 0) / a.length > 0) yearWin++;
  return { n, win: w / n, avg: s.reduce((a, b) => a + b, 0) / n, med: s[n >> 1], p10: s[Math.floor(n * 0.1)], years: byYear.size, yearWin };
}
export const fmt = (label: string, ts: Trade[]) => {
  const s = stat(ts);
  return `${label.padEnd(44)} n=${String(s.n).padStart(5)} 勝率${s.n ? (100 * s.win).toFixed(1).padStart(5) : "  —  "}% 平均${s.avg === null ? "—" : (s.avg >= 0 ? "+" : "−") + Math.abs(100 * s.avg).toFixed(2)}% 中央値${s.med === null ? "—" : (s.med >= 0 ? "+" : "−") + Math.abs(100 * s.med).toFixed(2)}% 下位10%${s.p10 === null ? "—" : (100 * s.p10).toFixed(1)}% 年勝ち${s.yearWin}/${s.years}`;
};
export const universe = () => ({ stocks: Object.keys(bars).length, days: days.length });
