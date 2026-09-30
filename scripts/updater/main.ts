import YahooFinance from "yahoo-finance2";
import type { IpoBase, IpoAuto, MarketData } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import { mergeIpos } from "../../src/lib/merge";
import { FILES } from "./config";
import { readJson, writeJsonIfChanged } from "./io";
import { fetchJpxListings, type JpxListing } from "./jpx";
import {
  fetchChartSinceListing,
  fetchCurrentPrice,
  fetchIndexCloses,
  toYahooTicker,
  type ChartQuote,
} from "./prices";
import { applySplitAndInitial } from "./split";
import { toJst, shouldRun } from "./schedule";
import { deriveStatus } from "./status";
import { largeHoldingReportsFromHoldings, runHoldingsUpdate } from "./holdings";
import { buildHotFile, writeHotFile } from "./hot";
import { buildMidtermFile, writeMidtermFile } from "./midterm";
import { buildIndicators, judgeSentiment } from "../../src/lib/market/sentiment";

// データ自動更新パイプラインのエントリポイント。
// 実行方法: npm run update:data （内部で `tsx scripts/updater/main.ts --force` を呼ぶ）
//
// 全体の流れ:
//   1. スケジュール判定（--force で強制実行）
//   2. base/auto を読み込み
//   3. JPXを1回フェッチ → auto へ反映（新規銘柄は discovered:true で追加）
//   4. status を自動導出（前進方向のみ auto に記録。巻き戻しはしない）
//   5. 上場済み銘柄の価格・出来高・決算日・株式分割を yahoo-finance2 で取得
//      （初値・初日出来高は分割係数で上場時の単位に戻して記録する。scripts/updater/split.ts）
//   6. EDINET から大量保有報告書を取得して holdings.json を書き、直近7日分を auto の largeHoldingReport に反映
//      （scripts/updater/holdings.ts。EDINET_API_KEY が無ければスキップし、既存の holdings.json はそのまま）
//   7. auto を書き込み
//   8. hot.json（いま熱い銘柄）を書き込み（5 で取った日足をそのまま使い、Yahoo への追加の取得はしない）
//   8.5 midterm.json（中長期セカンダリ。同じく 5 の日足だけで計算する）
//   9. market.json（地合い自動判定）を書き込み
//  10. 実行サマリを出力

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

/**
 * 価格取得の対象コード集合を拡張する。
 *
 * 既存の auto レコード（updater が既に把握している銘柄）に加えて、
 * base（手動管理・CSV由来含む）のうち上場日が直近730日以内、または
 * 上場予定（listingDate が空、または today より先）の銘柄も対象へ加える。
 * auto に未登録のコードはスケルトン（{ code }）を追加し、
 * updatePricesForListed 側のループ（autoMap 全体を走査）でそのまま拾われるようにする。
 *
 * base のみに存在する銘柄（CSV由来157件中139件）は従来 autoMap に入らず、
 * currentPrice/recentVolume が永久に埋まらないため、スクリーナー「高成長×流動性」
 * （直近出来高条件を含む）が恒常的に0件になっていた（data-pipeline-1 対応）。
 */
function expandPriceTargets(
  autoMap: Map<string, IpoAuto>,
  base: IpoBase[],
  today: string,
): void {
  const LOOKBACK_DAYS = 730;
  for (const b of base) {
    if (autoMap.has(b.code)) continue;
    if (!b.listingDate) {
      // 上場予定（上場日未定）も対象に含める。
      autoMap.set(b.code, { code: b.code });
      continue;
    }
    if (b.listingDate > today) {
      // 上場予定（上場日確定・未来日）。
      autoMap.set(b.code, { code: b.code });
      continue;
    }
    const listingDateObj = new Date(`${b.listingDate}T00:00:00+09:00`);
    if (Number.isNaN(listingDateObj.getTime())) continue;
    const daysSince = (Date.now() - listingDateObj.getTime()) / (24 * 3600 * 1000);
    if (daysSince >= 0 && daysSince <= LOOKBACK_DAYS) {
      autoMap.set(b.code, { code: b.code });
    }
  }
}

/**
 * 上場済み銘柄について価格・出来高・決算日・株式分割を取得し auto レコードへ反映する。
 *
 * 単位: currentPrice・recentVolume は現在の単位（Yahoo の値そのまま）。initialPrice・
 * initialVolume は上場時の単位（分割調整済みの日足を splitFactor で戻した値）。
 * 取得した日足は charts（code → 日足）にも入れ、hot.json の計算に使い回す。
 */
async function updatePricesForListed(
  autoMap: Map<string, IpoAuto>,
  base: IpoBase[],
  today: string,
  charts: Map<string, ChartQuote[]>,
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

      // 上場日からの日足と分割イベントを毎回取得する。分割係数（splitFactor）を計算し、
      // 初値・上場日出来高が未取得なら埋める。分割が判明した銘柄は上場時の単位で取り直す。
      const needsInitial =
        typeof record.initialPrice !== "number" || typeof record.initialVolume !== "number";
      const { quotes: chart, splits } = await fetchChartSinceListing(ticker, listingDate);
      charts.set(code, chart);
      const split = applySplitAndInitial(record, chart, splits, listingDate);
      if (split.skippedReason) {
        console.warn(`初値の単位修正を見送り: ${code}（${split.skippedReason}）`);
      } else if (split.initialUpdated && split.splitFactor !== 1) {
        console.log(
          `分割を反映: ${code} 係数${split.splitFactor} → 初値${record.initialPrice}・初日出来高${record.initialVolume}`,
        );
      }
      if (chart.length > 0) {
        // 直近出来高は毎回更新する（現在の単位）。
        const last = chart[chart.length - 1];
        if (typeof last.volume === "number") {
          record.recentVolume = last.volume;
        }
        if (needsInitial && typeof last.close === "number" && currentPrice === null) {
          record.currentPrice = last.close;
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
    } finally {
      // レート制限対策: 対象件数が base+auto 全体（数百件規模）に増えたため、
      // 1銘柄ごとに間隔を空ける（data-pipeline-1 対応）。
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return { updated, skipped };
}

// quote() から決算発表予定日を取るための yahoo-finance2 インスタンス。
// 日足・分割イベントの取得は prices.ts の fetchChartSinceListing を使う。
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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

  // 2.5) 価格取得対象を base+auto 全体（直近730日以内の上場済み＋上場予定）へ拡張
  expandPriceTargets(autoMap, base, today);

  // 3) 上場済み銘柄の価格・出来高・決算日（日足は charts に残して hot.json に使い回す）
  const charts = new Map<string, ChartQuote[]>();
  const { updated: priceUpdated, skipped: priceSkipped } = await updatePricesForListed(
    autoMap,
    base,
    today,
    charts,
  );

  // 4) EDINET 大量保有報告書（holdings.json を 1 晩分進め、直近7日の提出を largeHoldingReport に入れる）
  let edinetHits = 0;
  let holdingsSummary = "未実行";
  try {
    const holdings = await runHoldingsUpdate({ base, auto: Array.from(autoMap.values()), today });
    holdingsSummary = `${holdings.message}・書き込み${holdings.written ? "あり" : "なし"}・リクエスト ${holdings.requests} 本・${Math.round(holdings.durationMs / 1000)} 秒`;
    if (holdings.status !== "skipped" && holdings.file) {
      for (const [code, report] of largeHoldingReportsFromHoldings(holdings.file.items, today)) {
        const record = autoMap.get(code) ?? { code };
        record.largeHoldingReport = report;
        autoMap.set(code, record);
        edinetHits++;
      }
    }
  } catch (err) {
    holdingsSummary = `エラー（既存を維持）: ${(err as Error).message}`;
    console.warn(`EDINET取得エラー（スキップして続行）: ${(err as Error).message}`);
  }

  // 5) updatedAt を付与して auto を書き込み
  const nowIso = new Date().toISOString();
  for (const record of autoMap.values()) {
    record.updatedAt = nowIso;
  }
  const autoOut = Array.from(autoMap.values());
  const autoWritten = await writeJsonIfChanged(FILES.auto, autoOut);

  // 5.5) hot.json（いま熱い銘柄）。3) で取った日足だけで計算する（Yahoo への追加の取得はしない）。
  // 公開価格・初値・社名は base＋auto＋前回の enriched をマージした値を使う。
  let hotSummary = "未実行";
  let midSummary = "未実行";
  try {
    const enriched = await readJson<IpoEnriched[]>(FILES.enriched, []);
    const ipos = mergeIpos(base, autoOut, Array.isArray(enriched) ? enriched : []);
    // 5.6) midterm.json（中長期セカンダリ）。hot.json と同じ日足・同じマージ済み銘柄で計算する。
    try {
      const mid = buildMidtermFile(ipos, charts, new Date());
      const midResult = await writeMidtermFile(FILES.midterm, mid);
      midSummary =
        midResult === "keptEmpty"
          ? "対象0件のため既存を維持"
          : `${midResult === "written" ? "あり" : "なし（変更なし）"}（${mid.asOf} 終値・対象${mid.universe}件・−40%以下${mid.items.length}件）`;
    } catch (err) {
      midSummary = `エラー（既存を維持）: ${(err as Error).message}`;
      console.warn(`midterm.json 更新エラー（スキップ）: ${(err as Error).message}`);
    }
    const hot = buildHotFile(ipos, charts, new Date());
    const result = await writeHotFile(FILES.hot, hot);
    hotSummary =
      result === "keptEmpty"
        ? "対象0件のため既存を維持"
        : `${result === "written" ? "あり" : "なし（変更なし）"}（${hot.asOf} 終値・対象${hot.universe}件）`;
  } catch (err) {
    hotSummary = `エラー（既存を維持）: ${(err as Error).message}`;
    console.warn(`hot.json 更新エラー（スキップ）: ${(err as Error).message}`);
  }

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
  console.log(`EDINETヒット（直近7日の大量保有）: ${edinetHits}件`);
  console.log(`holdings.json: ${holdingsSummary}`);
  console.log(`ipos.auto.json 書き込み: ${autoWritten ? "あり" : "なし（変更なし）"}`);
  console.log(`market.json 書き込み: ${marketWritten ? "あり" : "なし（変更なし）"}`);
  console.log(`hot.json 書き込み: ${hotSummary}`);
  console.log(`midterm.json 書き込み: ${midSummary}`);
}

main().catch((err) => {
  console.error("update:data 実行中に致命的エラー:", err);
  process.exitCode = 1;
});
