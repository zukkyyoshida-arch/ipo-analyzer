import type { YutaiItem } from "../../src/lib/yutai/types";
import { fetchJpxEarningsRows, nextEarningsByCode, type EarningsRow } from "./yutai-earnings";
import { fetchYutaiDetail, type YutaiDetail } from "./yutai-detail";
import { loadAllCached, readCache, writeCache } from "./yutai-cache";
import { fetchProfitTrend, fetchYahooEarningsDate, type ProfitTrend } from "./yutai-yahoo";
import type { EarningsInfo, ExternalData } from "./yutai-external";
import { jstDateIso } from "./yutai";

// 優待の外部ソースの取得（通信あり）。キャッシュは scripts/updater/.cache/ 配下。1 秒間隔の逐次。
//   - 詳細ページ（業種・優待の状態）: yutai-detail/<code>.json  同じ暦月のキャッシュを使う（月 1 回）
//   - 決算発表予定日: JPX の xlsx 一式を yutai-earnings/jpx.json に 6 日キャッシュ（週 1 回）。
//     JPX に無い対象銘柄だけ Yahoo の calendarEvents（yutai-earnings-yahoo/<code>.json、6 日キャッシュ）
//   - 直近決算の増益／減益: yutai-profit/<code>.json  同じ暦月のキャッシュ（月 1 回）
// 件数を絞る（動作確認用）: 環境変数 YUTAI_LIMIT=3 で、詳細・決算（Yahoo）・利益それぞれ先頭 N 銘柄だけ取る。

const EARNINGS_CACHE_DAYS = 6;

/** 環境変数 YUTAI_LIMIT（正の整数）。無ければ undefined。 */
export function limitFromEnv(): number | undefined {
  const n = Number(process.env.YUTAI_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function limited<T>(xs: T[]): T[] {
  const n = limitFromEnv();
  return n ? xs.slice(0, n) : xs;
}

/** JPX の決算発表予定日の行（キャッシュあれば使う）。 */
export async function loadJpxEarningsRows(now: Date): Promise<{ rows: EarningsRow[]; files: number; fromCache: boolean }> {
  const cached = await readCache<{ rows: EarningsRow[]; files: number }>("yutai-earnings", "jpx", now, EARNINGS_CACHE_DAYS);
  if (cached) return { ...cached, fromCache: true };
  const got = await fetchJpxEarningsRows();
  await writeCache("yutai-earnings", "jpx", now, got);
  return { ...got, fromCache: false };
}

export interface LoadExternalOptions {
  /** 詳細ページ（業種・優待の状態）を取る銘柄（全月の items）。null で取らない */
  detailItems: YutaiItem[] | null;
  /** 決算発表予定日（JPX → Yahoo）と直近決算を取る対象（今月＋1・今月＋2 の items）。null で取らない */
  targetItems: YutaiItem[] | null;
  /** 直近決算（Yahoo）も取るか */
  profit: boolean;
}

/** 外部ソースをまとめて取る。取れなかったソースは空のまま返し、ログに出す（落とさない）。 */
export async function loadExternalData(now: Date, opts: LoadExternalOptions): Promise<ExternalData> {
  const ext: ExternalData = {};
  const todayIso = jstDateIso(now);

  if (opts.detailItems) {
    const urlByCode = new Map(opts.detailItems.map((it) => [it.code, it.detailUrl]));
    const codes = limited([...urlByCode.keys()].sort());
    console.log(`優待の詳細ページを用意します（${codes.length} 銘柄）`);
    const r = await loadAllCached<YutaiDetail>("yutai-detail", codes, now, (c) => fetchYutaiDetail(urlByCode.get(c) ?? ""), {
      label: "詳細ページ",
    });
    ext.detail = r.values;
    console.log(`  詳細ページ: キャッシュ ${r.count.cache}・取得 ${r.count.fetched}・失敗 ${r.failed.length}`);
  }

  if (opts.targetItems) {
    const targetCodes = [...new Set(opts.targetItems.map((it) => it.code))].sort();
    const earnings = new Map<string, EarningsInfo>();
    try {
      const jpx = await loadJpxEarningsRows(now);
      for (const [code, date] of nextEarningsByCode(jpx.rows, todayIso)) earnings.set(code, { date, source: "jpx" });
      console.log(`決算発表予定日（JPX）: xlsx ${jpx.files} 本・${jpx.rows.length} 行${jpx.fromCache ? "（キャッシュ）" : ""}`);
    } catch (err) {
      console.warn(`決算発表予定日（JPX）を取れなかったため Yahoo だけで補います: ${(err as Error).message}`);
    }
    const missing = limited(targetCodes.filter((c) => !earnings.has(c)));
    console.log(`  JPX に無い対象銘柄 ${missing.length} 件を Yahoo の calendarEvents で補います`);
    const y = await loadAllCached<{ date: string | null }>(
      "yutai-earnings-yahoo",
      missing,
      now,
      async (c) => ({ date: await fetchYahooEarningsDate(c, now) }),
      { label: "決算予定日（Yahoo）", maxAgeDays: EARNINGS_CACHE_DAYS },
    );
    let yahooHit = 0;
    for (const [code, v] of y.values) {
      if (v.date) {
        earnings.set(code, { date: v.date, source: "yahoo" });
        yahooHit++;
      }
    }
    console.log(`  Yahoo で日付が取れた ${yahooHit}/${missing.length}・失敗 ${y.failed.length}`);
    ext.earnings = earnings;

    if (opts.profit) {
      const codes = limited(targetCodes);
      console.log(`直近決算の増益／減益を用意します（${codes.length} 銘柄）`);
      const p = await loadAllCached<ProfitTrend>("yutai-profit", codes, now, (c) => fetchProfitTrend(c, now), { label: "直近決算" });
      ext.profit = p.values;
      const got = [...p.values.values()].filter((v) => v.profitAsOf).length;
      console.log(`  直近決算: キャッシュ ${p.count.cache}・取得 ${p.count.fetched}・失敗 ${p.failed.length}・値あり ${got}/${p.values.size}`);
    }
  }
  return ext;
}
