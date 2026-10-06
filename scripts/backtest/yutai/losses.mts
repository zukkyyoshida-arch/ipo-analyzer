import { buildTrades } from "./engine.mts";
const picks: [string, number, number][] = [["2597",12,60],["6592",12,60],["6078",12,60],["6546",12,60],["2501",12,60],["7272",12,60],["3082",12,60],["4826",12,60],["1663",12,60],["3246",1,80],["3169",1,80],["2424",1,80],["7614",1,80]];
for (const e of [60, 80]) {
  const all = buildTrades(e, 0).filter((t) => t.year >= 2017);
  const mkt = new Map<string, number[]>();
  for (const t of all) (mkt.get(`${t.year}-${t.month}`) ?? mkt.set(`${t.year}-${t.month}`, []).get(`${t.year}-${t.month}`)!).push(t.ret);
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  for (const [code, month, ee] of picks) {
    if (ee !== e) continue;
    const ts = all.filter((t) => t.code === code && t.month === month).sort((a, b) => a.year - b.year);
    console.log(`\n${code} ${month}月権利（${e}営業日前買い）`);
    console.log(ts.map((t) => `${t.year}:${(100 * t.ret).toFixed(0)}%${t.ret <= 0 ? "●" : ""}`).join(" "));
    for (const t of ts.filter((t) => t.ret <= 0)) console.log(`  負け ${t.year}: ${t.entryDate}→${t.exitDate} ${(100 * t.ret).toFixed(1)}%  同期間の市場中央値 ${(100 * med(mkt.get(`${t.year}-${t.month}`)!)).toFixed(1)}%`);
  }
}
