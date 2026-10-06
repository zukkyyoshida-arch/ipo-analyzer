import { buildTrades, stat, type Trade } from "./engine.mts";
const feats: [string, (t: Trade) => boolean][] = [
  ["過去≥80%(8年)", (t) => t.trailN >= 8 && t.trailWin / t.trailN >= 0.8],
  ["過去≥70%(5年)", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7],
  ["≤10万円", (t) => t.invest <= 100_000],
  ["≤20万円", (t) => t.invest <= 200_000],
  ["市場1か月−", (t) => t.mktRet1m !== null && t.mktRet1m <= 0],
  ["75日線下", (t) => t.aboveMa75 === false],
  ["株価位置≤50%", (t) => t.pos12 !== null && t.pos12 <= 0.5],
  ["1か月−5%未満", (t) => t.ret1m !== null && t.ret1m < -0.05],
  ["3月", (t) => t.month === 3],
  ["3・9月", (t) => t.month === 3 || t.month === 9],
  ["12月除外", (t) => t.month !== 12],
];
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1)}%`);
for (const [e, x] of [[80, 0], [60, 0], [40, 0], [60, 3]] as const) {
  const all = buildTrades(e, x).filter((t) => t.year >= 2017); // 過去勝率の算出に最低2年は要る
  const ctrl = buildTrades(e, x, "days", 1, { control: true }).filter((t) => t.year >= 2017);
  const rows: { label: string; n: number; win: number; med: number; p10: number; yw: string; ctrlWin: number | null }[] = [];
  const k = feats.length;
  for (let mask = 1; mask < 1 << k; mask++) {
    const idx = [...Array(k).keys()].filter((i) => mask & (1 << i));
    if (idx.length > 4) continue;
    if (idx.includes(2) && idx.includes(3)) continue; if (idx.includes(8) && idx.includes(9)) continue; if (idx.includes(0) && idx.includes(1)) continue;
    const f = (t: Trade) => idx.every((i) => feats[i][1](t));
    const ts = all.filter(f); if (ts.length < 400) continue;
    const s = stat(ts);
    const byYear = new Map<number, number[]>(); for (const t of ts) (byYear.get(t.year) ?? byYear.set(t.year, []).get(t.year)!).push(t.ret);
    const yearWinRates = [...byYear.values()].map((a) => a.filter((r) => r > 0).length / a.length);
    const minYear = Math.min(...yearWinRates);
    if (byYear.size < 8) continue;
    const c = ctrl.filter(f); const cs = c.length >= 100 ? stat(c) : null;
    rows.push({ label: idx.map((i) => feats[i][0]).join("×"), n: s.n, win: s.win, med: s.med!, p10: s.p10!, yw: `${s.yearWin}/${s.years} 最悪年${(100 * minYear).toFixed(0)}%`, ctrlWin: cs?.win ?? null });
  }
  rows.sort((a, b) => b.win - a.win);
  console.log(`\n## ${e}日前買い→${x}日前売り（2013年以降、n≥400、条件は4つまで）上位20`);
  for (const r of rows.slice(0, 20)) console.log(`${r.label.padEnd(44)} n=${String(r.n).padStart(5)} 勝率${(100 * r.win).toFixed(1)}% 中央値${pct(r.med)} 下位10%${pct(r.p10)} 年勝ち${r.yw} 対照勝率${r.ctrlWin === null ? "—" : (100 * r.ctrlWin).toFixed(1) + "%"}`);
}
