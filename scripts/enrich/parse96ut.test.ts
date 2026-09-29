// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IpoAuto, IpoBase } from "../../src/types/data";
import type { IpoEnriched } from "../../src/types/enriched";
import {
  detectStructureChange,
  extractCodeFromTitle,
  extractRawFields,
  normalizeLabel,
  normalizeToMillionYen,
  parse96utArticle,
  parse96utArticleWithDiagnostics,
  parseBbPeriodText,
  parseMajorShareholders,
  parsePriceRangeText,
  parseUnderwriterAllocations,
  extractNameFromTitle,
  parse96utHistorical,
  parseInitialPriceText,
  parseMarketText,
} from "./parse96ut";
import {
  dedupeHistory,
  HISTORY_FLUSH_EVERY,
  historyToCsv,
  isStockIpo,
  parseHistoryArgs,
  runHistory,
  selectHistoryUrls,
  summarizeHistory,
} from "./history";
import type { HistoricalIpo } from "../../src/types/history";
import {
  collectAllIpoArticleUrls,
  extractIpoArticleUrls,
  extractPostSitemapUrls,
  type FetchText,
} from "./sitemap";
import { fetchArticles, isListedCode, selectTargets, upsertEnriched } from "./main";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURE_DIR, name), "utf-8");
const FETCHED_AT = "2026-09-25T09:00:00.000Z";
const url = (n: string) => `https://kabu.96ut.com/article/ipo/${n}/`;

const KADOS = fixture("96ut-2024040.html");
const CHATPLUS = fixture("96ut-2026020.html");
const LUCRE = fixture("96ut-2026035-upcoming.html");
const VARIANT = fixture("96ut-variant-labels.html");
const CHANGED = fixture("96ut-structure-changed.html");

/** 主観評価（初値予想・BB参加姿勢など）の文字列がレコードに紛れ込んでいないか。 */
function containsSubjectiveText(record: IpoEnriched): boolean {
  const json = JSON.stringify(record);
  return /初値予想|直前予想|BB参加姿勢|やや積極的|やや強気|微妙/.test(json);
}

describe("parse96utArticle: 正常系（上場済 2024040 カドス）", () => {
  const rec = parse96utArticle(KADOS, url("2024040"), FETCHED_AT)!;

  it("コード・日程を抽出する", () => {
    expect(rec.code).toBe("211A");
    expect(rec.articleUrl).toBe(url("2024040"));
    expect(rec.priceRangeDecisionDate).toBe("2024-07-01");
    expect(rec.bbPeriod).toEqual({ start: "2024-07-02", end: "2024-07-08" });
    expect(rec.allotmentDate).toBe("2024-07-09");
    expect(rec.purchasePeriod).toEqual({ start: "2024-07-10", end: "2024-07-16" });
  });

  it("価格・株数・OR・吸収金額・時価総額を抽出する", () => {
    expect(rec.assumedPrice).toBe(2850);
    expect(rec.priceRange).toEqual({ low: 2850, high: 2900 });
    expect(rec.offeringPrice).toBe(2900);
    expect(rec.publicShares).toBe(198000);
    expect(rec.saleShares).toBe(232000);
    expect(rec.overAllotment).toBe(64500);
    expect(rec.issuedShares).toBe(948000);
    expect(rec.offeringRatio).toBe(52.2);
    expect(rec.absorptionAmountAssumed).toBe(14.0);
    expect(rec.absorptionAmount).toBe(14.3);
    expect(rec.absorptionAmountInitial).toBe(15.8);
    expect(rec.marketCap).toBe(27.4);
  });

  it("幹事団と割当・主幹事を抽出する（その他・注記行は除外）", () => {
    expect(rec.leadUnderwriter).toBe("SMBC日興証券");
    expect(rec.underwriterAllocations).toHaveLength(6);
    expect(rec.underwriterAllocations?.[0]).toEqual({
      name: "SMBC日興証券",
      shares: 387000,
      ratioPercent: 90,
      lotteryUnits: 387,
    });
    expect(rec.underwriters).toEqual([
      "SMBC日興証券",
      "野村證券",
      "大和証券",
      "SBI証券",
      "東海東京証券",
      "ひろぎん証券",
    ]);
  });

  it("会社概要・業績（千円→百万円正規化）・1株指標を抽出する", () => {
    expect(rec.companyProfile).toEqual({
      address: "山口県山口市小郡黄金町7番17号",
      established: "1999年02月01日",
      employeeCount: 97,
      auditor: "有限責任監査法人トーマツ",
    });
    expect(rec.financialHistory).toHaveLength(5);
    expect(rec.financialHistory?.[4]).toEqual({
      period: "2023年7月期",
      revenue: 5659.9,
      operatingProfit: 511.7,
      netProfit: 365.9,
      revenueChangePercent: 25.1,
    });
    expect(rec.financials).toEqual({
      revenue: 5659.9,
      revenueGrowth: 25.1,
      operatingProfit: 511.7,
      isProfitable: true,
    });
    expect(rec.eps).toBe(487.84);
    expect(rec.bps).toBe(4060.39);
  });

  it("大株主・ロックアップ・VC・SO を抽出する", () => {
    expect(rec.majorShareholders).toHaveLength(10);
    expect(rec.majorShareholders?.[0]).toEqual({
      name: "株式会社せんじゅ",
      shares: 240000,
      ratioPercent: 28.09,
      lockupDays: 180,
    });
    // ロックアップ欄が空の行は null。
    expect(rec.majorShareholders?.[9].lockupDays).toBeNull();
    expect(rec.existingShareholderLockupShares).toBe(536600);
    expect(rec.existingShareholderLockupCoverage).toBe(86.21);
    // 本文は「価格解除なし」→ false。
    expect(rec.lockup).toEqual({ days: 180, hasPriceRelease: false, coverage: 86.21 });
    expect(rec.vcHoldingShares).toBe(0);
    expect(rec.vcLockupShares).toBe(0);
    expect(rec.vcRatio).toBe(0);
    expect(rec.stockOptionShares).toBe(104400);
  });

  it("取得した全フィールドに sources があり、主観評価は取り込まない", () => {
    const fields = Object.keys(rec).filter(
      (k) => !["code", "articleUrl", "fetchedAt", "sources"].includes(k),
    );
    expect(fields.length).toBeGreaterThan(20);
    for (const f of fields) {
      expect(rec.sources[f]).toEqual({ url: url("2024040"), fetchedAt: FETCHED_AT });
    }
    expect(containsSubjectiveText(rec)).toBe(false);
  });
});

describe("parse96utArticle: 正常系（上場済 2026020 チャットプラス）", () => {
  const rec = parse96utArticle(CHATPLUS, url("2026020"), FETCHED_AT)!;

  it("主要フィールドを抽出する", () => {
    expect(rec.code).toBe("598A");
    expect(rec.bbPeriod).toEqual({ start: "2026-06-29", end: "2026-07-03" });
    expect(rec.priceRange).toEqual({ low: 1050, high: 1080 });
    expect(rec.offeringPrice).toBe(1080);
    expect(rec.offeringRatio).toBe(28.4);
    expect(rec.absorptionAmount).toBe(14.2);
    expect(rec.marketCap).toBe(50.2);
    expect(rec.leadUnderwriter).toBe("丸三証券");
    expect(rec.underwriterAllocations).toHaveLength(11);
    expect(rec.lockup).toEqual({ days: 180, hasPriceRelease: false, coverage: 100 });
    expect(rec.stockOptionShares).toBe(561400);
  });

  it("業績予想行（純資産・総資産が0）は financials に使わず、実績の最新期を使う", () => {
    const last = rec.financialHistory?.at(-1);
    expect(last?.period).toBe("2026年6月期（予想）");
    expect(rec.financials).toEqual({
      revenue: 1021.7,
      revenueGrowth: 36.3,
      operatingProfit: 369.1,
      isProfitable: true,
    });
    // 1株指標も実績の最新期（2025/06）に合わせる。
    expect(rec.eps).toBe(61.51);
  });

  it("目標株価の「1.5倍付近」はロックアップ解除条項とみなさない", () => {
    expect(rec.lockup?.hasPriceRelease).toBe(false);
  });
});

describe("parse96utArticle: 仮条件未発表（上場予定 2026035 ルクレ）", () => {
  const rec = parse96utArticle(LUCRE, url("2026035"), FETCHED_AT)!;

  it("priceRange は undefined、公開価格は null（出典なし）", () => {
    expect(rec.priceRange).toBeUndefined();
    expect(rec.sources.priceRange).toBeUndefined();
    expect(rec.offeringPrice).toBeNull();
    expect(rec.sources.offeringPrice).toBeUndefined();
    expect(rec.absorptionAmount).toBeUndefined();
    expect(rec.absorptionAmountInitial).toBeUndefined();
  });

  it("他のフィールドは取れる", () => {
    expect(rec.code).toBe("648A");
    expect(rec.bbPeriod).toEqual({ start: "2026-09-29", end: "2026-10-02" });
    expect(rec.assumedPrice).toBe(1360);
    expect(rec.publicShares).toBe(500000);
    expect(rec.saleShares).toBe(2840000);
    expect(rec.offeringRatio).toBe(40.4);
    expect(rec.absorptionAmountAssumed).toBe(52.2);
    expect(rec.marketCap).toBe(129);
    expect(rec.leadUnderwriter).toBe("野村證券");
    expect(rec.underwriterAllocations).toEqual([
      { name: "野村證券", shares: null, ratioPercent: null, lotteryUnits: null },
      { name: "SBI証券", shares: null, ratioPercent: null, lotteryUnits: null },
    ]);
    expect(rec.financials?.revenueGrowth).toBe(31.3);
    expect(rec.lockup?.coverage).toBe(100);
    expect(containsSubjectiveText(rec)).toBe(false);
  });
});

describe("parse96utArticle: ラベル表記揺れ版", () => {
  const rec = parse96utArticle(VARIANT, url("2026020"), FETCHED_AT)!;

  it("BB期間・公開価格・主幹事・半角チルダ・全角数字日付を吸収する", () => {
    expect(rec.code).toBe("598A");
    expect(rec.bbPeriod).toEqual({ start: "2026-06-29", end: "2026-07-03" });
    expect(rec.allotmentDate).toBe("2026-07-06");
    expect(rec.purchasePeriod).toEqual({ start: "2026-07-07", end: "2026-07-10" });
    expect(rec.priceRange).toEqual({ low: 1050, high: 1080 });
    expect(rec.offeringPrice).toBe(1080);
    expect(rec.overAllotment).toBe(172500);
    expect(rec.issuedShares).toBe(4650000);
    expect(rec.offeringRatio).toBe(28.4);
    expect(rec.leadUnderwriter).toBe("丸三証券");
  });

  it("構造変更とは判定しない", () => {
    const { diagnostics } = parse96utArticleWithDiagnostics(VARIANT, url("2026020"), FETCHED_AT);
    expect(diagnostics.structureChanged).toBe(false);
  });
});

describe("parse96utArticle: 構造大幅変更版", () => {
  it("detectStructureChange が true、例外は投げず部分的に取れたフィールドは返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { record, diagnostics } = parse96utArticleWithDiagnostics(
      CHANGED,
      url("2026035"),
      FETCHED_AT,
    );
    expect(diagnostics.structureChanged).toBe(true);
    expect(detectStructureChange(diagnostics.labelsFound)).toBe(true);
    expect(record?.code).toBe("648A");
    expect(record?.bbPeriod).toBeUndefined();
    expect(record?.leadUnderwriter).toBeUndefined();
    expect(record?.assumedPrice).toBe(1360);

    parse96utArticle(CHANGED, url("2026035"), FETCHED_AT);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("正常系フィクスチャでは false", () => {
    const labels = new Set(Object.keys(extractRawFields(KADOS)));
    expect(detectStructureChange(labels)).toBe(false);
    expect(detectStructureChange(new Set(["BB期間"]))).toBe(false);
    expect(detectStructureChange(new Set(["会社名", "所在地"]))).toBe(true);
  });

  it("タイトルからコードが取れなければ null", () => {
    expect(parse96utArticle("<html><h1>お知らせ</h1></html>", url("2026999"), FETCHED_AT)).toBeNull();
  });
});

describe("parsePriceRangeText", () => {
  it("円付きレンジ・全角チルダ", () => {
    expect(parsePriceRangeText("1,200円～1,400円")).toEqual({ low: 1200, high: 1400 });
  });
  it("半角チルダ・波ダッシュ・補足の括弧は読まない", () => {
    expect(parsePriceRangeText("1,200~1,400円")).toEqual({ low: 1200, high: 1400 });
    expect(parsePriceRangeText("1,200〜1,400円")).toEqual({ low: 1200, high: 1400 });
    expect(parsePriceRangeText("2,850～2,900円 (変動率：0.0% ～+1.8% やや強気 )")).toEqual({
      low: 2850,
      high: 2900,
    });
  });
  it("未発表・未定・ハイフンは null", () => {
    expect(parsePriceRangeText("未発表")).toBeNull();
    expect(parsePriceRangeText("未定")).toBeNull();
    expect(parsePriceRangeText("-")).toBeNull();
    expect(parsePriceRangeText("")).toBeNull();
  });
});

describe("parseBbPeriodText", () => {
  it("開始・終了が同一行（曜日カッコ書き）", () => {
    expect(parseBbPeriodText("開始: 2026/09/29 (火) ～ 終了: 2026/10/02 (金)")).toEqual({
      start: "2026-09-29",
      end: "2026-10-02",
    });
  });
  it("ゼロ埋めなし・全角・年月日表記", () => {
    expect(parseBbPeriodText("2026/6/29(月)~2026/7/3(金)")).toEqual({
      start: "2026-06-29",
      end: "2026-07-03",
    });
    expect(parseBbPeriodText("２０２６年９月２９日（火）～２０２６年１０月２日（金）")).toEqual({
      start: "2026-09-29",
      end: "2026-10-02",
    });
  });
  it("日付が1つ以下なら null", () => {
    expect(parseBbPeriodText("未定")).toBeNull();
    expect(parseBbPeriodText("2026/09/29 (火)")).toBeNull();
  });
});

describe("extractCodeFromTitle", () => {
  it("通常形式（数字3桁＋英字1桁）", () => {
    expect(extractCodeFromTitle("ルクレ(648A)のIPO新規上場情報")).toBe("648A");
  });
  it("数字4桁・社名内の括弧は無視", () => {
    expect(extractCodeFromTitle("SOLIZE（ソライズ）(5871)のIPO新規上場情報")).toBe("5871");
  });
  it("全角括弧・全角英数", () => {
    expect(extractCodeFromTitle("ＬＩＦＥ　ＣＲＥＡＴＥ（３５２Ａ）のIPO新規上場情報")).toBe("352A");
  });
  it("コードが無ければ null", () => {
    expect(extractCodeFromTitle("IPO新規上場情報")).toBeNull();
  });
});

describe("normalizeToMillionYen", () => {
  it("境界値: 99999 はそのまま、100000 は /1000", () => {
    expect(normalizeToMillionYen(99_999)).toBe(99_999);
    expect(normalizeToMillionYen(100_000)).toBe(100);
  });
  it("実データ相当値（千円表記の売上 5,659,947 → 5,659.947 百万円）", () => {
    expect(normalizeToMillionYen(5_659_947)).toBeCloseTo(5659.947, 3);
    expect(normalizeToMillionYen(-239_652)).toBeCloseTo(-239.652, 3);
    expect(normalizeToMillionYen(8_585)).toBe(8_585);
  });
});

describe("normalizeLabel", () => {
  it("全角→半角・件数・中点・ピリオドを吸収する", () => {
    expect(normalizeLabel("ＢＢ期間")).toBe("BB期間");
    expect(normalizeLabel("O.A.分")).toBe(normalizeLabel("ＯＡ分"));
    expect(normalizeLabel("既存株主総計(55)")).toBe("既存株主総計");
    expect(normalizeLabel("VC推定保有(0)（内ロックアップ）")).toBe("VC推定保有(内ロックアップ)");
  });
});

describe("parseUnderwriterAllocations / parseMajorShareholders", () => {
  it("抽選配分列を割当数と取り違えず・注記行を無視し、重複テーブルを二重計上しない", () => {
    const rows = parseUnderwriterAllocations(CHATPLUS);
    expect(rows).toHaveLength(11);
    expect(rows.at(-1)).toEqual({
      name: "極東証券",
      shares: 8600,
      ratioPercent: 0.75,
      lotteryUnits: null,
    });
  });
  it("株数の括弧内（売出株数）は読まない", () => {
    const rows = parseMajorShareholders(CHATPLUS);
    expect(rows[1]).toEqual({
      name: "大江 繭子",
      shares: 1335000,
      ratioPercent: 29.27,
      lockupDays: 180,
    });
  });
  it("ロックアップ欄の「180日 or 1.5倍」で価格解除条項ありと判定する", () => {
    const html = LUCRE.replace(
      "<td class='td_c'>180日</td>",
      "<td class='td_c'>180日 or 1.5倍</td>",
    );
    expect(html).not.toBe(LUCRE);
    const rec = parse96utArticle(html, url("2026035"), FETCHED_AT)!;
    expect(rec.lockup?.hasPriceRelease).toBe(true);
  });
});

describe("extractIpoArticleUrls", () => {
  it("article/ipo/<7桁>/ のみ抽出し、重複排除して昇順で返す", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://kabu.96ut.com/article/ipo/2026035/</loc></url>
      <url><loc>https://kabu.96ut.com/article/ipo/2024040/</loc></url>
      <url><loc>https://kabu.96ut.com/article/ipo/2026035/</loc></url>
      <url><loc>https://kabu.96ut.com/article/category/ipo/</loc></url>
      <url><loc>https://kabu.96ut.com/article/ipo/202603/</loc></url>
      <url><loc>https://kabu.96ut.com/article/news/2026001/</loc></url>
    </urlset>`;
    expect(extractIpoArticleUrls(xml)).toEqual([url("2024040"), url("2026035")]);
  });
  it("カテゴリ一覧HTMLのルート相対リンクも拾う", () => {
    const html = `<a href="/article/ipo/2026034/">A</a><a href='https://kabu.96ut.com/article/ipo/2026033/'>B</a>`;
    expect(extractIpoArticleUrls(html)).toEqual([url("2026033"), url("2026034")]);
  });
  it("サイトマップインデックスから post-sitemap*.xml を番号順に抽出する", () => {
    const index = `<sitemapindex>
      <sitemap><loc>https://kabu.96ut.com/sitemap-misc.xml</loc></sitemap>
      <sitemap><loc>https://kabu.96ut.com/post-sitemap2.xml</loc></sitemap>
      <sitemap><loc>https://kabu.96ut.com/post-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://kabu.96ut.com/page-sitemap.xml</loc></sitemap>
    </sitemapindex>`;
    expect(extractPostSitemapUrls(index)).toEqual([
      "https://kabu.96ut.com/post-sitemap.xml",
      "https://kabu.96ut.com/post-sitemap2.xml",
    ]);
  });
});

describe("collectAllIpoArticleUrls（fetch 注入）", () => {
  const noSleep = async () => {};
  const quiet = () => {};

  it("サイトマップから集め、カテゴリ1ページ目で補う", async () => {
    const pages: Record<string, string> = {
      "https://kabu.96ut.com/sitemap.xml":
        "<sitemapindex><sitemap><loc>https://kabu.96ut.com/post-sitemap.xml</loc></sitemap></sitemapindex>",
      "https://kabu.96ut.com/post-sitemap.xml": `<loc>${url("2026001")}</loc><loc>${url("2026002")}</loc>`,
      "https://kabu.96ut.com/article/category/ipo/": `<a href="${url("2026003")}">new</a><a href="${url("2026002")}">x</a>`,
    };
    const fetchText: FetchText = async (u) => {
      if (!(u in pages)) throw new Error(`404 ${u}`);
      return { text: pages[u], url: u };
    };
    const urls = await collectAllIpoArticleUrls({ fetchText, sleep: noSleep, warn: quiet });
    expect(urls).toEqual([url("2026001"), url("2026002"), url("2026003")]);
  });

  it("サイトマップ取得に失敗したらカテゴリ一覧（page/N/）にフォールバックする", async () => {
    const pages: Record<string, string> = {
      "https://kabu.96ut.com/article/category/ipo/": `<a href="${url("2026010")}">a</a>`,
      "https://kabu.96ut.com/article/category/ipo/page/2/": `<a href="${url("2026009")}">b</a>`,
    };
    const fetchText: FetchText = async (u) => {
      if (!(u in pages)) throw new Error(`404 ${u}`);
      return { text: pages[u], url: u };
    };
    const urls = await collectAllIpoArticleUrls({ fetchText, sleep: noSleep, warn: quiet });
    expect(urls).toEqual([url("2026009"), url("2026010")]);
  });
});

describe("main: 対象選別・upsert・取得", () => {
  const baseIpo = { code: "211A", status: "listed", listingDate: "2024-07-18" } as IpoBase;
  const auto: IpoAuto[] = [{ code: "648A", listingDate: "2026-10-15", discovered: true }];
  const existing: IpoEnriched[] = [
    { code: "211A", articleUrl: url("2024040"), fetchedAt: FETCHED_AT, sources: {} },
    { code: "648A", articleUrl: url("2026035"), fetchedAt: FETCHED_AT, sources: {} },
  ];

  it("取得済みの上場済み銘柄はスキップ、上場前・未取得は対象、minYear 未満は除外", () => {
    const { targets, skipped } = selectTargets(
      [url("2023100"), url("2024040"), url("2026035"), url("2026036")],
      existing,
      [baseIpo],
      auto,
      "2026-09-25",
      2024,
    );
    expect(skipped).toEqual([url("2024040")]);
    expect(targets).toEqual([url("2026035"), url("2026036")]);
  });

  it("isListedCode: 上場日が今日以前なら上場済み", () => {
    expect(isListedCode("648A", [], auto, undefined, "2026-10-15")).toBe(true);
    expect(isListedCode("648A", [], auto, undefined, "2026-10-14")).toBe(false);
  });

  it("upsertEnriched: code 単位で上書き、既存は削除しない", () => {
    const fresh: IpoEnriched[] = [
      { code: "648A", articleUrl: url("2026035"), fetchedAt: "2026-09-26T00:00:00.000Z", sources: {}, assumedPrice: 1360 },
      { code: "999A", articleUrl: url("2026040"), fetchedAt: "2026-09-26T00:00:00.000Z", sources: {} },
    ];
    const merged = upsertEnriched(existing, fresh);
    expect(merged.map((e) => e.code)).toEqual(["211A", "648A", "999A"]);
    expect(merged.find((e) => e.code === "648A")?.assumedPrice).toBe(1360);
  });

  it("fetchArticles: 失敗・リダイレクトはスキップして続行し、構造変更を数える", async () => {
    const pages: Record<string, { text: string; url: string }> = {
      [url("2024040")]: { text: KADOS, url: url("2024040") },
      [url("2025070")]: { text: KADOS, url: url("2026001") },
      [url("2026035")]: { text: CHANGED, url: url("2026035") },
    };
    const fetchText: FetchText = async (u) => {
      if (!(u in pages)) throw new Error("timeout");
      return pages[u];
    };
    const result = await fetchArticles(
      [url("2024040"), url("2025070"), url("2026000"), url("2026035")],
      { fetchText, sleep: async () => {}, now: () => FETCHED_AT, warn: () => {} },
    );
    expect(result.records.map((r) => r.code)).toEqual(["211A", "648A"]);
    expect(result.failedUrls).toEqual([url("2025070"), url("2026000")]);
    expect(result.structureChangedUrls).toEqual([url("2026035")]);
  });
});

describe("抽選配分（lotteryUnits）", () => {
  it("カドス: 387枚/19枚/9枚/19枚/4枚 を幹事順に取り込む", () => {
    const rows = parseUnderwriterAllocations(KADOS);
    expect(rows.slice(0, 5).map((r) => r.lotteryUnits)).toEqual([387, 19, 9, 19, 4]);
  });
  it("「-」・空セルは null", () => {
    const rows = parseUnderwriterAllocations(LUCRE);
    expect(rows.map((r) => r.lotteryUnits)).toEqual([null, null]);
  });
  it("抽選配分列が無い表では lotteryUnits を持たない", () => {
    const html = `<table><tr><th>証券会社名</th><th>割当数</th><th>割当(%)</th></tr>
      <tr><td>野村證券</td><td>1,000株</td><td>100%</td></tr></table>`;
    const rows = parseUnderwriterAllocations(html);
    expect(rows).toEqual([{ name: "野村證券", shares: 1000, ratioPercent: 100 }]);
    expect("lotteryUnits" in rows[0]).toBe(false);
  });
});

describe("履歴用の個別パーサ", () => {
  it("parseMarketText: 旧市場を現行3区分へ読み替え、地方・PRO は null", () => {
    expect(parseMarketText("東M")).toBe("グロース");
    expect(parseMarketText("東証マザーズ")).toBe("グロース");
    expect(parseMarketText("東G")).toBe("グロース");
    expect(parseMarketText("JQS")).toBe("スタンダード");
    expect(parseMarketText("JASDAQグロース")).toBe("スタンダード");
    expect(parseMarketText("東2")).toBe("スタンダード");
    expect(parseMarketText("東S")).toBe("スタンダード");
    expect(parseMarketText("東1")).toBe("プライム");
    expect(parseMarketText("東証プライム")).toBe("プライム");
    expect(parseMarketText("名証2部")).toBeNull();
    expect(parseMarketText("札幌アンビシャス")).toBeNull();
    expect(parseMarketText("福証Q-Board")).toBeNull();
    expect(parseMarketText("TOKYO PRO Market")).toBeNull();
    expect(parseMarketText("")).toBeNull();
  });
  it("parseInitialPriceText: 円付き数値、公募比の括弧は読まない、未定・-は null", () => {
    expect(parseInitialPriceText("3,210円 (公募比: +310円/+10.7%)")).toBe(3210);
    expect(parseInitialPriceText("１，０５０円")).toBe(1050);
    expect(parseInitialPriceText("-")).toBeNull();
    expect(parseInitialPriceText("未定")).toBeNull();
    expect(parseInitialPriceText("まだ更新していません")).toBeNull();
  });
  it("extractNameFromTitle: コードの括弧より前を社名にする（社名内の括弧は残す）", () => {
    expect(extractNameFromTitle("カドス・コーポレーション(211A)のIPO新規上場情報")).toBe(
      "カドス・コーポレーション",
    );
    expect(extractNameFromTitle("ABC(ホールディングス)(1234)のIPO新規上場情報")).toBe(
      "ABC(ホールディングス)",
    );
    expect(extractNameFromTitle("IPO新規上場情報")).toBeNull();
  });
});

describe("parse96utHistorical", () => {
  it("上場済（カドス）: 社名・市場・上場日・初値・売出比率・幹事社数を持つ圧縮レコード", () => {
    const h = parse96utHistorical(KADOS, url("2024040"), FETCHED_AT)!;
    expect(h).toMatchObject({
      code: "211A",
      name: "カドス・コーポレーション",
      market: "スタンダード",
      listingDate: "2024-07-18",
      offeringPrice: 2900,
      initialPrice: 3210,
      assumedPrice: 2850,
      priceRange: { low: 2850, high: 2900 },
      absorptionAmount: 14.3,
      offeringRatio: 52.2,
      saleRatio: 54,
      underwriterCount: 6,
      leadUnderwriter: "SMBC日興証券",
      lockupDays: 180,
      lockupHasPriceRelease: false,
      sourceUrl: url("2024040"),
      fetchedAt: FETCHED_AT,
    });
  });
  it("上場前（ルクレ）: 初値・公開価格は null、吸収金額は想定ベースで補う", () => {
    const h = parse96utHistorical(LUCRE, url("2026035"), FETCHED_AT)!;
    expect(h.initialPrice).toBeNull();
    expect(h.offeringPrice).toBeNull();
    expect(h.priceRange).toBeNull();
    expect(h.absorptionAmount).toBe(52.2);
    expect(h.listingDate).toBe("2026-10-15");
  });
  it("undefined を含まない（全項目が値か null）", () => {
    const h = parse96utHistorical(CHATPLUS, url("2026020"), FETCHED_AT)!;
    expect(Object.values(h).every((v) => v !== undefined)).toBe(true);
    expect(h.initialPrice).toBe(2284);
  });
  it("タイトルにコードが無い古い記事は本文ヘッダ [7813] からコード・社名を補う", () => {
    const html = KADOS.replaceAll(
      "カドス・コーポレーション(211A)のIPO新規上場情報",
      "カドス・コーポレーションのIPO新規上場情報",
    ).replace("<b>[211A]</b>", "<b>[7813]</b>");
    expect(html).not.toBe(KADOS);
    const h = parse96utHistorical(html, url("2015020"), FETCHED_AT)!;
    expect(h.code).toBe("7813");
    expect(h.name).toBe("カドス・コーポレーション");
    // enriched 側のパーサ挙動は変えない（タイトル基準のまま）。
    expect(parse96utArticle(html, url("2015020"), FETCHED_AT)).toBeNull();
  });
  it("コードが取れない記事は null", () => {
    expect(parse96utHistorical("<html><h1>無題</h1></html>", url("2015001"), FETCHED_AT)).toBeNull();
  });
});

const hist = (code: string, listingDate: string, num: string): HistoricalIpo => ({
  ...parse96utHistorical(KADOS, url("2024040"), FETCHED_AT)!,
  code,
  listingDate,
  sourceUrl: url(num),
});

describe("history（2015〜2023 の履歴データ）", () => {
  it("selectHistoryUrls: 記事番号の年で絞り、昇順で返す", () => {
    const urls = [url("2024001"), url("2015002"), url("2014099"), url("2023104"), url("2015001")];
    expect(selectHistoryUrls(urls, 2015, 2023)).toEqual([
      url("2015001"),
      url("2015002"),
      url("2023104"),
    ]);
  });
  it("dedupeHistory: code 重複は新しい記事を優先し、上場日昇順", () => {
    const out = dedupeHistory([
      hist("1111", "2016-03-01", "2016010"),
      hist("2222", "2015-12-01", "2015090"),
      hist("1111", "2017-05-01", "2017020"),
    ]);
    expect(out.map((r) => `${r.code}:${r.listingDate}`)).toEqual(["2222:2015-12-01", "1111:2017-05-01"]);
  });
  it("historyToCsv: priceRange を2列に展開し、null は空セル・カンマは引用符で囲む", () => {
    const r = { ...hist("3333", "2018-01-01", "2018001"), name: "A,B", initialPrice: null };
    const [header, row] = historyToCsv([r]).trim().split("\n");
    const cols = header.split(",");
    expect(cols).toContain("priceRangeLow");
    expect(cols).not.toContain("priceRange");
    expect(row).toContain('"A,B"');
    expect(row.split(",")[cols.indexOf("initialPrice") + 1]).toBe("");
  });
  it("parseHistoryArgs: --from/--to を読み、無ければ 2015〜2023", () => {
    expect(parseHistoryArgs(["--history", "--from", "2018", "--to", "2020"])).toEqual({
      fromYear: 2018,
      toYear: 2020,
    });
    expect(parseHistoryArgs(["--history"])).toEqual({ fromYear: 2015, toYear: 2023 });
  });
  it("runHistory: 失敗・リダイレクトはスキップし、flushEvery 件ごとと最後に保存する", async () => {
    // 記事のパースは1件あたり数百msかかるため、件数を絞って性質だけを確かめる（既定100件は下のテストで確認）。
    const nums = Array.from({ length: 12 }, (_, i) => `2016${String(i + 1).padStart(3, "0")}`);
    const fetchText: FetchText = async (u) => {
      const n = u.match(/(\d{7})/)![1];
      if (n === "2016005") throw new Error("HTTP 500");
      if (n === "2016006") return { text: KADOS, url: url("2016007") };
      const code = String(1000 + Number(n.slice(4)));
      return { text: KADOS.replace(/\(211A\)/g, `(${code})`), url: u };
    };
    const saves: number[] = [];
    const summary = await runHistory({
      fromYear: 2015,
      toYear: 2023,
      fetchText,
      sleep: async () => {},
      now: () => FETCHED_AT,
      warn: () => {},
      collectUrls: async () => [...nums.map(url), url("2024001")],
      save: async (records) => {
        saves.push(records.length);
      },
      flushEvery: 5,
    });
    expect(summary.targetCount).toBe(12);
    expect(summary.failedUrls).toEqual([url("2016005"), url("2016006")]);
    expect(summary.records).toHaveLength(10);
    // 5件目時点で成功4件、10件目時点で成功8件、最後に成功10件。
    expect(saves).toEqual([4, 8, 10]);
  });
  it("HISTORY_FLUSH_EVERY: 途中保存の既定間隔は100件", () => {
    expect(HISTORY_FLUSH_EVERY).toBe(100);
  });
  it("isStockIpo: REIT・インフラファンド（投資法人）は除く", () => {
    expect(isStockIpo({ name: "ケネディクス商業リート投資法人" })).toBe(false);
    expect(isStockIpo({ name: "タカラレーベン・インフラ投資法人" })).toBe(false);
    expect(isStockIpo({ name: "カドス・コーポレーション" })).toBe(true);
  });
  it("summarizeHistory: 年別・市場別件数と欠損率", () => {
    const s = summarizeHistory([
      hist("1", "2015-01-01", "2015001"),
      { ...hist("2", "2016-01-01", "2016001"), market: null, initialPrice: null },
    ]);
    expect(s.byYear).toEqual({ "2015": 1, "2016": 1 });
    expect(s.byMarket).toEqual({ スタンダード: 1, その他: 1 });
    expect(s.missingRate.initialPrice).toBe(50);
    expect(s.missingRate.offeringPrice).toBe(0);
  });
});
