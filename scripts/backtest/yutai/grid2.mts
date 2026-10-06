import { buildTrades, fmt, universe } from "./engine.mts";
console.log("universe", universe());
console.log("\n## 対照（権利月を6か月ずらした同じ長さの窓＝優待需給なし）との比較");
for (const e of [80, 60, 40, 20, 10, 5]) {
  console.log(fmt(`${e}日前買い→最終日売り【優待月】`, buildTrades(e, 0)));
  console.log(fmt(`${e}日前買い→最終日売り【対照:6か月ずらし】`, buildTrades(e, 0, "days", 1, { control: true })));
}
console.log("\n## 出口の違い（40日前買い）");
console.log(fmt("→最終日大引け", buildTrades(40, 0)));
console.log(fmt("→前日大引け", buildTrades(40, 1)));
console.log(fmt("→権利落ち日の寄り（優待をもらう）", buildTrades(40, 0, "days", 1, { exitMode: "exDayOpen" })));
console.log("\n## 損切り（40日前買い→最終日売り）");
for (const sl of [null, -0.05, -0.1, -0.15]) console.log(fmt(`損切り ${sl === null ? "なし" : sl * 100 + "%"}`, buildTrades(40, 0, "days", 1, { stopLoss: sl })));
