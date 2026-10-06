import { buildTrades, fmt, universe } from "./engine.mts";
console.log("universe", universe());
console.log("\n## エントリー×出口（営業日ベース、全銘柄・全権利月・2016〜2025）");
for (const e of [60, 40, 30, 20, 15, 10, 5, 3]) for (const x of [0, 1, 3, 5]) if (x < e) console.log(fmt(`権利付最終日の${e}日前に買い→${x}日前に売り`, buildTrades(e, x)));
console.log("\n## 月初買い（前月初・2か月前初）→権利付最終日売り");
for (const mb of [1, 2, 3]) for (const x of [0, 1, 3, 5]) console.log(fmt(`${mb}か月前の月初に買い→${x}日前に売り`, buildTrades(0, x, "monthStart", mb)));
