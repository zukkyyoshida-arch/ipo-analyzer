// 今日時点でルールが選ぶ銘柄。過去成績は同じ戦略（entryBefore 営業日前買い→最終日売り）の 2013〜2025 年の結果。
import fs from "node:fs";
import { buildTrades, loadBars, meta, type Trade } from "./engine.mts";
const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const feat = (code: string) => {
  const b = loadBars(code); if (!b) return null;
  const n = b.length; if (n < 80) return null;
  const last = b[n - 1]; if (last[0] < new Date(Date.parse(today) - 14 * 86_400_000).toISOString().slice(0, 10)) return null;
  const w = b.slice(n - 250), hi = Math.max(...w.map((r) => r[2])), lo = Math.min(...w.map((r) => r[3]));
  const ma75 = b.slice(n - 75).reduce((s, r) => s + r[4], 0) / 75;
  return { price: last[4], date: last[0], pos12: hi > lo ? (last[4] - lo) / (hi - lo) : null, aboveMa75: last[4] > ma75, ret1m: last[4] / b[n - 22][4] - 1 };
};
// 市場の直近1か月（全銘柄の中央値）
const r1 = Object.keys(meta).map((c) => feat(c)?.ret1m).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
console.log(`市場1か月（優待銘柄中央値）: ${(100 * r1[r1.length >> 1]).toFixed(1)}% → 「市場1か月−」条件は ${r1[r1.length >> 1] <= 0 ? "成立" : "不成立"}`);
for (const [month, e] of [[12, 60], [1, 80]] as const) {
  const hist = buildTrades(e, 0).filter((t) => t.month === month && t.year >= 2013);
  const by = new Map<string, Trade[]>(); for (const t of hist) (by.get(t.code) ?? by.set(t.code, []).get(t.code)!).push(t);
  const rows: any[] = [];
  for (const [code, ts] of by) {
    const m = meta[code]; const f = feat(code); if (!f) continue;
    const n = ts.length, w = ts.filter((t) => t.ret > 0).length, avg = ts.reduce((s, t) => s + t.ret, 0) / n;
    const worst = Math.min(...ts.map((t) => t.ret));
    rows.push({ code, name: m.name, n, w, rate: w / n, avg, worst, invest: f.price * 100, minInvest: m.minInvest, ...f, sector: m.sector, earn: m.nextEarningsDate, status: m.yutaiStatus });
  }
  const D = rows.filter((r) => r.n >= 8 && r.rate >= 0.8 && r.invest <= 200_000 && r.status !== "abolished").sort((a, b) => b.rate - a.rate || b.n - a.n || b.avg - a.avg);
  console.log(`\n## ${month}月権利（${e}営業日前買い→権利付最終日売り） ルールD: 過去8年以上で勝率80%以上 × 100株20万円以下  該当 ${D.length} 本`);
  for (const r of D.slice(0, 15)) console.log(`${r.code} ${r.name.padEnd(14)} ${r.w}/${r.n}勝 平均${(100 * r.avg).toFixed(1).padStart(5)}% 最悪${(100 * r.worst).toFixed(1).padStart(6)}% 株価${String(r.price).padStart(6)} 100株${Math.round(r.invest / 1e4)}万 優待最低${r.minInvest ? Math.round(r.minInvest / 1e4) + "万" : "—"} ${r.aboveMa75 ? "75日線上" : "75日線下"} 位置${r.pos12 === null ? "—" : Math.round(100 * r.pos12) + "%"} 1か月${(100 * r.ret1m).toFixed(1)}% ${r.sector ?? ""} 決算${r.earn ?? "—"}`);
  const B = rows.filter((r) => r.n >= 5 && r.rate >= 0.7 && r.invest <= 100_000 && !r.aboveMa75 && r.status !== "abolished").sort((a, b) => b.rate - a.rate || b.n - a.n);
  console.log(`\n   ルールB/F の銘柄条件（過去≥70%×10万円以下×75日線下）を満たすもの ${B.length} 本（市場条件は上記）`);
  for (const r of B.slice(0, 10)) console.log(`   ${r.code} ${r.name.padEnd(14)} ${r.w}/${r.n}勝 平均${(100 * r.avg).toFixed(1)}% 100株${Math.round(r.invest / 1e4)}万 位置${Math.round(100 * (r.pos12 ?? 0))}%`);
}

console.log("\n\n===== ルールC（過去≥70%・5年以上 × 100株20万円以下 × 市場1か月−）上位 =====");
for (const [month, e] of [[12, 60], [1, 80], [11, 40]] as const) {
  const hist = buildTrades(e, 0).filter((t) => t.month === month && t.year >= 2013);
  const by = new Map<string, Trade[]>(); for (const t of hist) (by.get(t.code) ?? by.set(t.code, []).get(t.code)!).push(t);
  const rows: any[] = [];
  for (const [code, ts] of by) {
    const m = meta[code]; const f = feat(code); if (!f || m.yutaiStatus === "abolished") continue;
    const n = ts.length, w = ts.filter((t) => t.ret > 0).length;
    if (n < 5 || w / n < 0.7 || f.price * 100 > 200_000) continue;
    rows.push({ code, name: m.name, n, w, rate: w / n, avg: ts.reduce((s, t) => s + t.ret, 0) / n, worst: Math.min(...ts.map((t) => t.ret)), streak: (() => { let k = 0; for (const t of [...ts].sort((a, b) => b.year - a.year)) { if (t.ret > 0) k++; else break; } return k; })(), ...f, minInvest: m.minInvest, sector: m.sector, earn: m.nextEarningsDate });
  }
  rows.sort((a, b) => b.rate - a.rate || b.n - a.n || b.avg - a.avg);
  console.log(`\n## ${month}月権利（${e}営業日前買い→権利付最終日売り） 該当 ${rows.length} 本、上位12`);
  for (const r of rows.slice(0, 12)) console.log(`${r.code} ${r.name.padEnd(14)} ${r.w}/${r.n}勝 連勝${r.streak} 平均${(100 * r.avg).toFixed(1).padStart(5)}% 最悪${(100 * r.worst).toFixed(1).padStart(6)}% 株価${String(r.price).padStart(6)} 100株${String(Math.round(r.price * 100 / 1e4)).padStart(2)}万 優待最低${r.minInvest ? Math.round(r.minInvest / 1e4) + "万" : "—"} ${r.aboveMa75 ? "75上" : "75下"} 位置${r.pos12 === null ? "—" : Math.round(100 * r.pos12) + "%"} ${r.sector ?? ""} 決算${r.earn ?? "—"}`);
}
