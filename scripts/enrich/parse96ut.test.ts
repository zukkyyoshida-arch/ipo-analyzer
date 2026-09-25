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
} from "./parse96ut";
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
      { name: "野村證券", shares: null, ratioPercent: null },
      { name: "SBI証券", shares: null, ratioPercent: null },
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
  it("抽選配分列・注記行を無視し、重複テーブルを二重計上しない", () => {
    const rows = parseUnderwriterAllocations(CHATPLUS);
    expect(rows).toHaveLength(11);
    expect(rows.at(-1)).toEqual({ name: "極東証券", shares: 8600, ratioPercent: 0.75 });
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
