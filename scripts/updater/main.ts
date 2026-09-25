import YahooFinance from "yahoo-finance2";
import type { IpoBase, IpoAuto, MarketData } from "../../src/types/data";
import { FILES } from "./config";
import { readJson, writeJsonIfChanged } from "./io";
import { fetchJpxListings, type JpxListing } from "./jpx";
import { fetchCurrentPrice, fetchIndexCloses, toYahooTicker } from "./prices";
import { toJst, shouldRun } from "./schedule";
import { deriveStatus } from "./status";
import { fetchLargeHoldingReports } from "./edinet";
import { buildIndicators, judgeSentiment } from "../../src/lib/market/sentiment";

// データ自動更新パイプラインのエントリポイント。
// 実行方法: npm run update:data （内部で `tsx scripts/updater/main.ts --force` を呼ぶ）
//
// 全体の流れ:
//   1. スケジュール判定（--force で強制実行）
//   2. base/auto を読み込み
//   3. JPXを1回フェッチ → auto へ反映（新規銘柄は discovered:true で追加）
//   4. status を自動導出（前進方向のみ auto に記録。巻き戻しはしない）
//   5. 上場済み銘柄の価格・出来高・決算日を yahoo-finance2 で取得
//   6. EDINETから大量保有報告書を取得して反映
//   7. auto を書き込み
//   8. market.json（地合い自動判定）を書き込み
//   9. 実行サマリを出力

/** 今日の日付（YYYY-MM-DD、JST基準）。 */
function todayJst(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const jst = new Date(utc + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** auto 配列を code をキーにした Map に変換。 */
function toAutoMap(auto: IpoAuto[]): Map<string, IpoAuto> {
  const map = new Map<string, IpoAuto>();
  for (const a of auto) map.set(a.code, { ...a });
  return map;
}

/** status の進行順（auto は前進方向のみ記録する）。 */
const STATUS_ORDER: Record<string, number> = {
  upcoming: 0,
  bb_open: 1,
  priced: 2,
  listed: 3,
};

/** JPX の1銘柄分を auto レコードへ反映する（銘柄名・市場区分・上場日等）。 */
function applyJpxListing(
  autoMap: Map<string, IpoAuto>,
  baseCodes: Set<string>,
  listing: JpxListing,
): { discoveredNew: boolean } {
  const existing = autoMap.get(listing.code);
  const record: IpoAuto = existing ?? { code: listing.code };

  if (listing.listingDate) record.listingDate = listing.listingDate;
  if (listing.market) record.market = listing.market;
  if (listing.name) record.name = listing.name;
  // priceRange は Ipo 側に直接対応するフィールドが無いため auto には保持しない
  // （base 側の priceRange は手動管理。新規発見銘柄は skeletonFromAuto が
  //  既定値 {0,0} を使う。取得できた仮条件は将来の拡張用にログのみ残す）。

  const discoveredNew = !existing && !baseCodes.has(listing.code);
  if (discoveredNew) {
    record.discovered = true;
  }

  autoMap.set(listing.code, record);
  return { discoveredNew };
}

/** status を導出し、前進方向のみ auto に記録する。 */
function applyDerivedStatus(
  autoMap: Map<string, IpoAuto>,
  base: IpoBase[],
  today: string,
): void {
  const baseByCode = new Map(base.map((b) => [b.code, b]));

  for (const [code, record] of autoMap) {
    const baseRecord = baseByCode.get(code);
    // status 導出に必要な日付は base（手動管理）を優先し、無ければ auto 由来を使う。
    const listingDate = baseRecord?.listingDate || record.listingDate || "";
    const bbStart = baseRecord?.bbPeriod.start ?? "";
    const bbEnd = baseRecord?.bbPeriod.end ?? "";

    const derived = deriveStatus({ bbStart, bbEnd, listingDate }, today);

    const currentBaseStatus = baseRecord?.status ?? "upcoming";
    const currentAutoStatus = record.status;
    // 「前進のみ」: base の現状 と 既存の auto 記録 の両方より進んでいる場合のみ更新。
    const baseline = Math.max(
      STATUS_ORDER[currentBaseStatus] ?? 0,
      currentAutoStatus ? STATUS_ORDER[currentAutoStatus] ?? 0 : 0,
    );
    if (STATUS_ORDER[derived] > baseline) {
      record.status = derived;
    }
  }
}

/** yahoo-finance2 の quote から決算発表予定日を YYYY-MM-DD へ変換。取れなければ undefined。 */
function extractEarningsDate(earningsTimestamp: unknown): string | undefined {
  if (earningsTimestamp instanceof Date && !Number.isNaN(earningsTimestamp.getTime())) {
    return earningsTimestamp.toISOString().slice(0, 10);
  }
  return undefined;
}

/** 上場済み銘柄について価格・出来高・決算日を取得し auto レコードへ反映する。 */
async function updatePricesForListed(
  autoMap: Map<string, IpoAuto>,
  base: IpoBase[],
  today: string,
): Promise<{ updated: number; skipped: number }> {
  const baseByCode = new Map(base.map((b) => [b.code, b]));
  let updated = 0;
  let skipped = 0;

  for (const [code, record] of autoMap) {
    const listingDate = baseByCode.get(code)?.listingDate || record.listingDate || "";
    if (!listingDate || listingDate > today) continue; // 未上場はスキップ

    const ticker = toYahooTicker(code);
    try {
      // 現在値
      const currentPrice = await fetchCurrentPrice(ticker);
      if (currentPrice !== null) {
        record.currentPrice = currentPrice;
      }

      // 初値・上場日出来高が未取得なら、上場日からの日足を取得して埋める。
      const needsInitial =
        typeof record.initialPrice !== "number" || typeof record.initialVolume !== "number";
      if (needsInitial) {
        const listingDateObj = new Date(`${listingDate}T00:00:00+09:00`);
        const lookbackDays = Math.max(
          1,
          Math.ceil((Date.now() - listingDateObj.getTime()) / (24 * 3600 * 1000)) + 3,
        );
        const chart = await fetchChartQuotes(ticker, lookbackDays);
        if (chart.length > 0) {
          const first = chart[0];
          if (typeof first.open === "number") {
            record.initialPrice = first.open;
          }
          if (typeof first.volume === "number") {
            record.initialVolume = first.volume;
          }
          const last = chart[chart.length - 1];
          if (typeof last.volume === "number") {
            record.recentVolume = last.volume;
          }
          if (typeof last.close === "number" && currentPrice === null) {
            record.currentPrice = last.close;
          }
        }
      } else {
        // 初値取得済みでも直近出来高は毎回更新する。
        const chart = await fetchChartQuotes(ticker, 10);
        if (chart.length > 0) {
          const last = chart[chart.length - 1];
          if (typeof last.volume === "number") {
            record.recentVolume = last.volume;
          }
        }
      }

      // 決算発表予定日（取得できた場合のみ）
      const earningsDate = await fetchEarningsDate(ticker);
      if (earningsDate) {
        record.firstEarningsDate = earningsDate;
      }

      updated++;
    } catch (err) {
      // サンプルデータの架空銘柄（存在しないティッカー）等はここで静かにスキップ。
      console.warn(`価格取得スキップ: ${code} (${(err as Error).message})`);
      skipped++;
    }
  }

  return { updated, skipped };
}

// prices.ts の fetchDailyCloses は終値のみを返す設計だが、ここでは初値(open)や出来高(volume)も
// 必要なため、同じ yahoo-finance2 インスタンスを使い chart を直接呼ぶ薄いラッパを用意する。
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

interface ChartQuote {
  date: Date;
  open: number | null;
  close: number | null;
  volume: number | null;
}

async function fetchChartQuotes(
  ticker: string,
  lookbackDays: number,
): Promise<ChartQuote[]> {
  const period2 = new Date();
  const period1 = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  const chart = await yf.chart(ticker, { period1, period2, interval: "1d" });
  return chart.quotes
    .filter((q) => q.open !== null || q.close !== null || q.volume !== null)
    .map((q) => ({ date: q.date, open: q.open, close: q.close, volume: q.volume }));
}

/** quote() から決算発表予定日を取得。取得不能・存在しない銘柄は null。 */
async function fetchEarningsDate(ticker: string): Promise<string | undefined> {
  try {
    const q = await yf.quote(ticker);
    return extractEarningsDate((q as unknown as Record<string, unknown>).earningsTimestamp);
  } catch {
    return undefined;
  }
}

/** 直近上場銘柄の初値騰落率（%）を計算する（offeringPrice が分かる base 銘柄のみ対象）。 */
function computeRecentIpoReturns(base: IpoBase[], autoMap: Map<string, IpoAuto>): number[] {
  const listed = base
    .filter((b) => b.status === "listed" && b.offeringPrice && b.offeringPrice > 0)
    .sort((a, b) => (a.listingDate < b.listingDate ? 1 : -1))
    .slice(0, 10);

  const returns: number[] = [];
  for (const b of listed) {
    const initialPrice = autoMap.get(b.code)?.initialPrice ?? b.initialPrice;
    if (typeof initialPrice === "number" && initialPrice > 0 && b.offeringPrice) {
      returns.push(((initialPrice - b.offeringPrice) / b.offeringPrice) * 100);
    }
  }
  return returns;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  if (!force && !shouldRun(toJst(new Date()))) {
    console.log("スケジュール対象外の時間帯のため終了します。");
    return;
  }

  const today = todayJst();

  const base = await readJson<IpoBase[]>(FILES.base, []);
  const autoList = await readJson<IpoAuto[]>(FILES.auto, []);
  const autoMap = toAutoMap(autoList);
  const baseCodes = new Set(base.map((b) => b.code));

  // 1) JPX新規上場ページを1回フェッチ
  let jpxDiscovered = 0;
  let jpxError: string | null = null;
  try {
    const listings = await fetchJpxListings();
    for (const listing of listings) {
      const { discoveredNew } = applyJpxListing(autoMap, baseCodes, listing);
      if (discoveredNew) jpxDiscovered++;
    }
  } catch (err) {
    jpxError = (err as Error).message;
    console.warn(`JPX取得エラー（スキップして続行）: ${jpxError}`);
  }

  // 2) status 自動導出（前進方向のみ）
  applyDerivedStatus(autoMap, base, today);

  // 3) 上場済み銘柄の価格・出来高・決算日
  const { updated: priceUpdated, skipped: priceSkipped } = await updatePricesForListed(
    autoMap,
    base,
    today,
  );

  // 4) EDINET 大量保有報告書
  const allCodes = Array.from(new Set([...baseCodes, ...autoMap.keys()]));
  let edinetHits = 0;
  try {
    const reports = await fetchLargeHoldingReports(allCodes);
    for (const [code, report] of reports) {
      const record = autoMap.get(code) ?? { code };
      record.largeHoldingReport = report;
      autoMap.set(code, record);
      edinetHits++;
    }
  } catch (err) {
    console.warn(`EDINET取得エラー（スキップして続行）: ${(err as Error).message}`);
  }

  // 5) updatedAt を付与して auto を書き込み
  const nowIso = new Date().toISOString();
  for (const record of autoMap.values()) {
    record.updatedAt = nowIso;
  }
  const autoOut = Array.from(autoMap.values());
  const autoWritten = await writeJsonIfChanged(FILES.auto, autoOut);

  // 6) market.json 更新
  let marketWritten = false;
  try {
    const { nikkei, growth250 } = await fetchIndexCloses();
    const recentIpoReturns = computeRecentIpoReturns(base, autoMap);
    const indicators = buildIndicators({
      nikkeiCloses: nikkei,
      growth250Closes: growth250,
      recentIpoReturns,
    });
    const sentiment = judgeSentiment(indicators);
    const marketData: MarketData = {
      sentiment,
      indicators,
      updatedAt: nowIso,
    };
    marketWritten = await writeJsonIfChanged(FILES.market, marketData);
  } catch (err) {
    console.warn(`market.json 更新エラー（スキップ）: ${(err as Error).message}`);
  }

  // 7) サマリ出力
  console.log("=== update:data サマリ ===");
  console.log(`JPX新規発見: ${jpxDiscovered}件${jpxError ? `（取得失敗: ${jpxError}）` : ""}`);
  console.log(`価格更新: ${priceUpdated}件 / スキップ: ${priceSkipped}件`);
  console.log(`EDINETヒット: ${edinetHits}件`);
  console.log(`ipos.auto.json 書き込み: ${autoWritten ? "あり" : "なし（変更なし）"}`);
  console.log(`market.json 書き込み: ${marketWritten ? "あり" : "なし（変更なし）"}`);
}

main().catch((err) => {
  console.error("update:data 実行中に致命的エラー:", err);
  process.exitCode = 1;
});
