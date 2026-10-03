import type { IpoAuto, IpoBase } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import { mergeIpos } from "../../src/lib/merge";
import { normalizeCode } from "../../src/lib/margin/file";
import { FILES } from "./config";
import { readJson } from "./io";
import { runMarginUpdate } from "./margin";

// 信用取引残高（public/data/margin.json）だけを作り直す。
// 実行: npm run margin:data
// 対象は ipos.base.json + ipos.auto.json（+ ipos.enriched.json）を合成した全銘柄（上場日では絞らない）。
// 失敗しても既存の margin.json を残し、警告ログだけで正常終了する（夜間ジョブを止めない）。

async function main(): Promise<void> {
  const base = await readJson<IpoBase[]>(FILES.base, []);
  const auto = await readJson<IpoAuto[]>(FILES.auto, []);
  const enriched = await readJson<IpoEnriched[]>(FILES.enriched, []);
  const ipos = mergeIpos(base, auto, Array.isArray(enriched) ? enriched : []);
  const keep = new Set<string>();
  for (const ipo of ipos) {
    const code = normalizeCode(ipo.code);
    if (code) keep.add(code);
  }
  console.log(`margin:data 開始（対象 ${keep.size} 銘柄）`);
  const result = await runMarginUpdate(FILES.margin, keep, new Date());
  if (result.status === "kept") {
    console.warn(`[warn] margin:data: ${result.message}`);
  } else {
    console.log(`margin:data: ${result.message}（基準日 ${result.asOf}・${result.count} 銘柄・${result.sourceUrl}）`);
  }
}

main().catch((err) => {
  console.warn("[warn] margin:data 実行中にエラー（既存ファイルは残す）:", (err as Error).message);
});
