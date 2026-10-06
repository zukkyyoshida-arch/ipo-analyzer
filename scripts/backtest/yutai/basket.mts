// 権利月イベント（年×月）ごとに、条件を満たす銘柄から過去勝率の高い順に最大 N 本を等金額で持ったときの「イベント単位の勝率」。
import { buildTrades, type Trade } from "./engine.mts";
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1)}%`;
type Rule = { name: string; e: number; x: number; f: (t: Trade) => boolean };
const rules: Rule[] = [
  { name: "A 60日前買い: ≤10万×75日線下×市場1か月−×3・9月", e: 60, x: 0, f: (t) => t.invest <= 1e5 && t.aboveMa75 === false && (t.mktRet1m ?? 1) <= 0 && (t.month === 3 || t.month === 9) },
  { name: "B 60日前買い: 過去≥70%×≤10万×市場1か月−×75日線下", e: 60, x: 0, f: (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 1e5 && (t.mktRet1m ?? 1) <= 0 && t.aboveMa75 === false },
  { name: "C 60日前買い: 過去≥70%×≤20万×市場1か月−（月問わず）", e: 60, x: 0, f: (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 2e5 && (t.mktRet1m ?? 1) <= 0 },
  { name: "D 60日前買い: 過去≥80%(8年)×≤20万（地合い条件なし）", e: 60, x: 0, f: (t) => t.trailN >= 8 && t.trailWin / t.trailN >= 0.8 && t.invest <= 2e5 },
  { name: "E 60日前買い: 過去≥70%×≤10万×75日線下（地合い条件なし）", e: 60, x: 0, f: (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 1e5 && t.aboveMa75 === false },
  { name: "F 80日前買い: 過去≥70%×≤10万×市場1か月−×12月除外", e: 80, x: 0, f: (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 1e5 && (t.mktRet1m ?? 1) <= 0 && t.month !== 12 },
  { name: "G 40日前買い: 過去≥70%×≤20万×株価位置≤50%×3月", e: 40, x: 0, f: (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 2e5 && (t.pos12 ?? 1) <= 0.5 && t.month === 3 },
  { name: "H 60日前買い: 条件なし（全銘柄から過去勝率上位10）", e: 60, x: 0, f: (t) => t.trailN >= 5 },
];
const cache = new Map<string, Trade[]>();
for (const r of rules) {
  const key = `${r.e}/${r.x}`;
  const all = cache.get(key) ?? cache.set(key, buildTrades(r.e, r.x).filter((t) => t.year >= 2017)).get(key)!;
  const sel = all.filter(r.f);
  const ev = new Map<string, Trade[]>();
  for (const t of sel) (ev.get(`${t.year}-${String(t.month).padStart(2, "0")}`) ?? ev.set(`${t.year}-${String(t.month).padStart(2, "0")}`, []).get(`${t.year}-${String(t.month).padStart(2, "0")}`)!).push(t);
  const totalEvents = new Set(all.map((t) => `${t.year}-${t.month}`)).size;
  for (const N of [5, 10]) {
    let n = 0, w = 0; const rets: number[] = []; const lines: string[] = [];
    for (const [k, ts] of [...ev.entries()].sort()) {
      if (ts.length < 3) continue;
      const top = ts.sort((a, b) => b.trailWin / b.trailN - a.trailWin / a.trailN || b.trailN - a.trailN).slice(0, N);
      const r = top.reduce((s, t) => s + t.ret, 0) / top.length;
      n++; if (r > 0) w++; rets.push(r); lines.push(`${k}:${pct(r)}(${top.length})`);
    }
    const s = [...rets].sort((a, b) => a - b);
    console.log(`\n${r.name} / 上位${N}本の等金額バスケット`);
    console.log(`  イベント ${n}回（全権利月イベント ${totalEvents} のうち条件成立 ${Math.round(100 * n / totalEvents)}%） 勝ち ${w}/${n} = ${n ? Math.round(100 * w / n) : 0}%  平均${pct(rets.reduce((a, b) => a + b, 0) / (n || 1))} 中央値${pct(s[n >> 1] ?? 0)} 最悪${pct(s[0] ?? 0)}`);
    if (N === 10) console.log("  " + lines.join(" "));
  }
}
