// 基本戦略（引数: entryDays exitDays）に対し、エントリー時点で分かる条件で絞ったときの勝率を一覧にする。
import { buildTrades, fmt, universe, type Trade } from "./engine.mts";
const entry = Number(process.argv[2] ?? 30), exit = Number(process.argv[3] ?? 0);
const mode = (process.argv[4] ?? "days") as "days" | "monthStart"; const mb = Number(process.argv[5] ?? 1);
console.log("universe", universe(), `戦略: ${mode === "days" ? `${entry}営業日前買い` : `${mb}か月前月初買い`}→${exit}日前売り`);
const all = buildTrades(entry, exit, mode, mb);
const recent = all.filter((t) => t.year >= 2016);
const F: [string, (t: Trade) => boolean][] = [
  ["全体", () => true],
  ["2016年以降のみ", (t) => t.year >= 2016],
  ["過去勝率: 5年以上あり", (t) => t.trailN >= 5],
  ["過去勝率 ≥60%（5年以上）", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.6],
  ["過去勝率 ≥70%（5年以上）", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7],
  ["過去勝率 ≥80%（5年以上）", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.8],
  ["過去勝率 ≥80%（8年以上）", (t) => t.trailN >= 8 && t.trailWin / t.trailN >= 0.8],
  ["過去 全勝（5年以上）", (t) => t.trailN >= 5 && t.trailWin === t.trailN],
  ["過去平均 ≥+3%（5年以上）", (t) => t.trailN >= 5 && (t.trailAvg ?? 0) >= 0.03],
  ["過去勝率 ≤40%（5年以上）", (t) => t.trailN >= 5 && t.trailWin / t.trailN <= 0.4],
  ["100株 ≤10万円", (t) => t.invest <= 100_000],
  ["100株 ≤20万円", (t) => t.invest <= 200_000],
  ["100株 20〜50万円", (t) => t.invest > 200_000 && t.invest <= 500_000],
  ["100株 >50万円", (t) => t.invest > 500_000],
  ["株価位置 ≥85%（年高値圏）", (t) => t.pos12 !== null && t.pos12 >= 0.85],
  ["株価位置 50〜85%", (t) => t.pos12 !== null && t.pos12 >= 0.5 && t.pos12 < 0.85],
  ["株価位置 15〜50%", (t) => t.pos12 !== null && t.pos12 >= 0.15 && t.pos12 < 0.5],
  ["株価位置 ≤15%（年安値圏）", (t) => t.pos12 !== null && t.pos12 <= 0.15],
  ["75日線の上", (t) => t.aboveMa75 === true],
  ["75日線の下", (t) => t.aboveMa75 === false],
  ["直近1か月 +5%超（勢い）", (t) => t.ret1m !== null && t.ret1m > 0.05],
  ["直近1か月 −5%未満（押し目）", (t) => t.ret1m !== null && t.ret1m < -0.05],
  ["直近3か月 +10%超", (t) => t.ret3m !== null && t.ret3m > 0.1],
  ["市場1か月 プラス（全銘柄中央値）", (t) => t.mktRet1m !== null && t.mktRet1m > 0],
  ["市場1か月 マイナス", (t) => t.mktRet1m !== null && t.mktRet1m <= 0],
  ["権利月 3月", (t) => t.month === 3],
  ["権利月 9月", (t) => t.month === 9],
  ["権利月 3・9月以外", (t) => t.month !== 3 && t.month !== 9],
  ["権利月 12月", (t) => t.month === 12],
  ["権利月 6月", (t) => t.month === 6],
  ["権利月 端境月(1,4,5,7,10,11)", (t) => [1, 4, 5, 7, 10, 11].includes(t.month)],
  ["複合: 過去≥70%×75日線上", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.aboveMa75 === true],
  ["複合: 過去≥70%×≤20万円", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.invest <= 200_000],
  ["複合: 過去≥70%×3・9月以外", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.month !== 3 && t.month !== 9],
  ["複合: 過去≥70%×75日線上×市場1か月+", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.7 && t.aboveMa75 === true && (t.mktRet1m ?? 0) > 0],
  ["複合: 過去≥80%×75日線上", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.8 && t.aboveMa75 === true],
  ["複合: 過去≥80%×75日線上×1か月+", (t) => t.trailN >= 5 && t.trailWin / t.trailN >= 0.8 && t.aboveMa75 === true && (t.ret1m ?? -1) > 0],
  ["複合: 過去≥80%(8年)×75日線上×3・9月以外", (t) => t.trailN >= 8 && t.trailWin / t.trailN >= 0.8 && t.aboveMa75 === true && t.month !== 3 && t.month !== 9],
];
for (const [label, f] of F) console.log(fmt(label, all.filter(f)));
console.log("\n## 年別（全体）");
for (let y = 2016; y <= 2025; y++) console.log(fmt(`${y}`, all.filter((t) => t.year === y)));
console.log("\n## 業種別（2016年以降、n≥100）");
const sec = new Map<string, Trade[]>();
for (const t of recent) (sec.get(t.sector ?? "不明") ?? sec.set(t.sector ?? "不明", []).get(t.sector ?? "不明")!).push(t);
[...sec.entries()].filter(([, v]) => v.length >= 100).sort((a, b) => b[1].filter((t) => t.ret > 0).length / b[1].length - a[1].filter((t) => t.ret > 0).length / a[1].length).forEach(([k, v]) => console.log(fmt(k, v)));
