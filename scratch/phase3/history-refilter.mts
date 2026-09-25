import { readFileSync } from "node:fs";
import type { HistoricalIpo } from "../../src/types/history";
import { HISTORY_FILES, isStockIpo, saveHistoryFiles, summarizeHistory } from "../../scripts/enrich/history";

// 取得済み ipos.history.json に REIT 等の除外を後から適用する（再取得せずに済ませるための一回限り）。
const all = JSON.parse(readFileSync(HISTORY_FILES.json, "utf-8")) as HistoricalIpo[];
const kept = all.filter(isStockIpo);
const removed = all.filter((r) => !isStockIpo(r));
await saveHistoryFiles(kept);
console.log(`before=${all.length} after=${kept.length} removed=${removed.length}`);
console.log(removed.map((r) => r.name).join(" / "));
console.log(JSON.stringify(summarizeHistory(kept)));
const others = kept.filter((r) => r.market === null);
console.log(`market=null: ${others.length}`, others.slice(0, 15).map((r) => `${r.code}:${r.name}`).join(", "));
const noInit = kept.filter((r) => r.initialPrice === null);
console.log(`initial null: ${noInit.length}`, noInit.map((r) => `${r.code}:${r.name}:${r.listingDate}`).join(", "));
const noOffer = kept.filter((r) => r.offeringPrice === null);
console.log(`offering null: ${noOffer.length}`, noOffer.map((r) => `${r.code}:${r.name}`).join(", "));
console.log("uwNull", kept.filter((r) => r.underwriterCount === null).length, "lockupNull", kept.filter((r) => r.lockupDays === null).length, "revNull", kept.filter((r) => r.revenueGrowth === null).length, "vcNull", kept.filter((r) => r.vcRatio === null).length);
