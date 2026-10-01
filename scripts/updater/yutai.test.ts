import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adjustQuotes,
  buildYutaiFile,
  cleanCompanyName,
  computeYutaiBaseline,
  coversPreviousMonth,
  parseRightsMonths,
  parseYutaiListPage,
  sameExceptGeneratedAt,
  serializeYutaiIndexFile,
  serializeYutaiMonthFile,
  splitFactorOf,
  splitYutaiFile,
  summarizePrevMonth,
  toMonthBars,
  yutaiListPageUrl,
  type MonthBar,
  type RawMonthlyQuote,
  type YutaiListRow,
} from "./yutai";

const fixture = readFileSync(
  path.join(__dirname, "__fixtures__", "daiwair-yutai-list-month5.html"),
  "utf-8",
);

describe("大和IR 一覧 HTML のパース", () => {
  const page = parseYutaiListPage(fixture);

  it("行・件数・ページ数を読む", () => {
    expect(page.totalCount).toBe(42);
    expect(page.maxPage).toBe(3);
    expect(page.rows.map((r) => r.code)).toEqual(["1377", "138A", "189A", "2884"]);
  });

  it("最低投資金額・権利月を読み、利回りは読まない", () => {
    const [sakata, hikari, , yoshimura] = page.rows;
    expect(sakata).toEqual({
      code: "1377",
      name: "サカタのタネ",
      minInvest: 429500,
      rightsMonths: [5],
      detailUrl: "https://yutai-guide.daiwair.co.jp/stock/detail/1377",
    });
    expect(hikari.name).toBe("光フードサービス");
    expect(hikari.rightsMonths).toEqual([5, 11]);
    expect(yoshimura.rightsMonths).toEqual([2, 5, 8, 11]);
  });

  it("社名の (株) を除き、HTML エンティティをデコードする", () => {
    expect(cleanCompanyName("(株)Ａ&amp;Ｂ&#12471;ステム")).toBe("Ａ&Ｂシステム");
    expect(cleanCompanyName("テスト（株）")).toBe("テスト");
  });

  it("行の無いページでも落ちない", () => {
    expect(parseYutaiListPage("<html></html>")).toEqual({ rows: [], maxPage: 1, totalCount: null });
  });

  it("権利月の表記ゆれ", () => {
    expect(parseRightsMonths("3、9月")).toEqual([3, 9]);
    expect(parseRightsMonths("毎月")).toHaveLength(12);
  });

  it("ページ URL", () => {
    expect(yutaiListPageUrl(5, 2)).toBe(
      "https://yutai-guide.daiwair.co.jp/stock?keyword=&month=5&ct_id=&sort_id=&pager=&page=2",
    );
  });
});

/** Yahoo の月足と同じく「前月末 15:00Z」（= JST の月初）の date を作る。 */
function monthly(year: number, month: number, open: number, close: number, extra: Partial<RawMonthlyQuote> = {}): RawMonthlyQuote {
  const d = new Date(Date.UTC(year, month - 1, 1) - 9 * 3600 * 1000);
  return { date: d.toISOString(), open, close, high: Math.max(open, close) + 10, low: Math.min(open, close) - 10, ...extra };
}

describe("月足のまとめ直し", () => {
  it("UTC の date を JST に直して年月を判定する", () => {
    const bars = toMonthBars([{ date: "2016-01-31T15:00:00.000Z", open: 100, close: 110, high: 120, low: 90 }]);
    expect(bars).toEqual([{ year: 2016, month: 2, open: 100, close: 110, high: 120, low: 90 }]);
  });

  it("同じ年月のライブ行はひとつにまとめ、始値/終値の無い行は捨てる", () => {
    const bars = toMonthBars([
      { date: "2026-09-30T06:30:00.000Z", open: 4600, high: 4620, low: 4575, close: 4620 },
      { date: "2026-08-31T15:00:00.000Z", open: 4775, high: 4815, low: 4590, close: 4680 },
      { date: "2026-07-31T15:00:00.000Z", open: null, high: 1, low: 1, close: 1 },
    ]);
    expect(bars).toEqual([{ year: 2026, month: 9, open: 4775, high: 4815, low: 4575, close: 4620 }]);
  });

  it("前月の大引け後に取ったキャッシュだけを「前月まで揃っている」とみなす", () => {
    const now = new Date("2026-10-01T01:00:00Z");
    expect(coversPreviousMonth([{ date: "2026-09-30T06:30:00.000Z" }], now)).toBe(true);
    expect(coversPreviousMonth([{ date: "2026-09-15T06:30:00.000Z" }], now)).toBe(false);
    expect(coversPreviousMonth([], now)).toBe(false);
    // 前月末が日曜なら金曜の大引け後で足りる（2026-05-31 は日曜）
    expect(coversPreviousMonth([{ date: "2026-05-29T07:00:00.000Z" }], new Date("2026-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("分割・配当の補正", () => {
  it("adjclose/close の比率で 4 本値を補正し、adjclose が無い行はそのまま", () => {
    const rows = adjustQuotes([
      { date: "2025-12-31T15:00:00.000Z", open: 1000, high: 1100, low: 900, close: 1050, adjclose: 1029 },
      { date: "2026-01-31T15:00:00.000Z", open: 1050, high: 1060, low: 1000, close: 1040 },
    ]);
    expect(rows[0].open).toBeCloseTo(980);
    expect(rows[0].high).toBeCloseTo(1078);
    expect(rows[0].low).toBeCloseTo(882);
    expect(rows[0].close).toBeCloseTo(1029);
    expect(rows[1]).toMatchObject({ open: 1050, high: 1060, low: 1000, close: 1040 });
  });

  it("Yahoo が未反映の分割（月内のライブ行で段差）は、前の行を分割後の値に揃える", () => {
    // 2026-09 の月足は分割前（5,000 円台）、09-30 のライブ行は 1:4 分割後
    const bars = toMonthBars([
      { date: "2026-07-31T15:00:00.000Z", open: 5080, high: 5240, low: 5010, close: 5090, adjclose: 5090 },
      { date: "2026-08-31T15:00:00.000Z", open: 5090, high: 5240, low: 5030, close: 5130, adjclose: 5130 },
      { date: "2026-09-30T06:30:00.000Z", open: 1255, high: 1276, low: 1253, close: 1265, adjclose: 1265 },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0].open).toBeCloseTo(1270);
    expect(bars[1].open).toBeCloseTo(1272.5);
    expect(bars[1].close).toBe(1265);
    expect(bars[1].high).toBe(1310); // 5240/4 と 1276 の大きい方
  });

  it("値幅制限の内側の動きは分割とみなさない。よくある倍率には寄せる", () => {
    expect(splitFactorOf(0.75)).toBeNull();
    expect(splitFactorOf(1.5)).toBeNull();
    expect(splitFactorOf(0.2446)).toBe(0.25);
    expect(splitFactorOf(0.48)).toBe(0.5);
    expect(splitFactorOf(9.4)).toBe(10);
    expect(splitFactorOf(0.34)).toBeCloseTo(1 / 3);
    expect(splitFactorOf(0.07)).toBe(0.07); // どの倍率からも遠ければ比率そのもの
    expect(splitFactorOf(0.0)).toBeNull();
  });
});

describe("前月の月足の集計", () => {
  // 2014〜2026 年の 9 月足。偶数年は陽線、奇数年は陰線
  const quotes: RawMonthlyQuote[] = [];
  for (let y = 2014; y <= 2026; y++) {
    quotes.push(monthly(y, 9, 100, y % 2 === 0 ? 110 : 95));
    quotes.push(monthly(y, 10, 100, 100));
  }
  const all = toMonthBars(quotes);

  it("10 年・5 年は暦年で揃え、実行年の足は完結していても使わない（2026-10 実行: 2016〜25 年・2021〜25 年）", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    const bars = all.filter((b) => b.year < 2026 || b.month <= 9); // 2026-10 の足はまだ無い
    const s = summarizePrevMonth(bars, 9, now);
    expect(s.candles.map((c) => c.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(s.candles[0]).toEqual({ year: 2016, open: 100, close: 110, high: 120, low: 90 });
    expect(s.n10).toBe(10);
    expect(s.up10).toBe(5);
    expect(s.n5).toBe(5);
    expect(s.up5).toBe(2); // 2022・2024（2026 は含めない）
    expect(s.avgRet10).toBeCloseTo((0.1 * 5 - 0.05 * 5) / 10, 6);
    expect(s.avgHighRet10).toBeCloseTo((0.2 * 5 + 0.1 * 5) / 10, 6);
    expect(s.price).toBe(110);
  });

  it("実行月がどこでも範囲は同じ（2026-09 実行でも 2016〜25 年）。price は未完結の当月の足も使う", () => {
    const now = new Date("2026-09-20T03:00:00Z");
    const bars = all.filter((b) => b.year < 2026 || b.month <= 9);
    const s = summarizePrevMonth(bars, 9, now);
    expect(s.candles.map((c) => c.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(s.price).toBe(110);
  });

  it("high12・low12 は完結した月足だけで見る（実行月の未完結の足は入れない）", () => {
    const bars: MonthBar[] = [
      { year: 2026, month: 8, open: 100, close: 100, high: 110, low: 95 },
      { year: 2026, month: 9, open: 100, close: 100, high: 120, low: 90 },
      { year: 2026, month: 10, open: 100, close: 200, high: 250, low: 50 }, // 未完結
    ];
    const s = summarizePrevMonth(bars, 9, new Date("2026-10-15T03:00:00Z"));
    expect(s.high12).toBe(120);
    expect(s.low12).toBe(90);
    expect(s.price).toBe(200);
  });

  it("上場が浅い銘柄は本数が 10 未満、高値の無い足は高値平均から除く", () => {
    const bars: MonthBar[] = [
      { year: 2024, month: 4, open: 100, close: 120, high: null, low: null },
      { year: 2025, month: 4, open: 100, close: 90, high: 130, low: 80 },
    ];
    const s = summarizePrevMonth(bars, 4, new Date("2026-10-01T00:00:00Z"));
    expect([s.up10, s.n10, s.up5, s.n5]).toEqual([1, 2, 1, 2]);
    expect(s.avgRet10).toBeCloseTo(0.05, 6);
    expect(s.avgHighRet10).toBeCloseTo(0.3, 6);
    expect(s.candles[0]).toMatchObject({ high: null, low: null });
    expect(s.high12).toBe(130);
    expect(s.low12).toBe(80);
  });

  it("YutaiFile: 陽線割合→平均騰落率の順に並べ、前月の足が無い銘柄は除き、地合いを付ける", () => {
    const row = (code: string): YutaiListRow => ({
      code,
      name: code,
      minInvest: null,
      rightsMonths: [10],
      detailUrl: "",
    });
    const mk = (closes: number[]): MonthBar[] =>
      closes.map((c, i) => ({ year: 2020 + i, month: 9, open: 100, close: c, high: null, low: null }));
    const bars = new Map<string, MonthBar[]>([
      ["A", mk([90, 110, 110])], // 2/3
      ["B", mk([110, 105, 90])], // 2/3、直近 5 本の陽線は同数 → 平均騰落率で並ぶ
      ["C", mk([110, 110, 120])], // 3/3
      ["D", mk([105, 105, 105])], // 3/3、平均騰落率が C より低い
      ["E", [{ year: 2025, month: 3, open: 1, close: 2, high: null, low: null }]], // 9 月足が無い
    ]);
    const f = buildYutaiFile([{ month: 10, rows: ["A", "B", "C", "D", "E", "F"].map(row) }], bars, new Date("2026-10-01T00:00:00Z"));
    expect(f.asOf).toBe("2026-10-01");
    const m = f.months["10"];
    expect(m.prevMonth).toBe(9);
    expect(m.listedCount).toBe(6);
    expect(m.items.map((i) => i.code)).toEqual(["C", "D", "A", "B"]);
    expect(m.items[0]).not.toHaveProperty("yutaiYield");
    expect(m.baseline?.n).toBe(4);
    expect(m.baseline?.years.map((y) => y.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(m.baseline?.years[4]).toEqual({ year: 2020, n: 4, winRate: 0.75, avgRet: 0.0375, avgHighRet: null });
    expect(m.baseline?.years[0]).toEqual({ year: 2016, n: 0, winRate: null, avgRet: null, avgHighRet: null });
    expect(m.baseline?.winRate10).toBeCloseTo(10 / 12, 4);
  });

  it("地合い: 年ごとと 10 年全体の勝率・平均・最大上昇（高値の無い足は最大上昇から除く）", () => {
    const c = (year: number, close: number, high: number | null) => ({ year, open: 100, close, high, low: null });
    const b = computeYutaiBaseline(
      [{ candles: [c(2024, 110, 120), c(2025, 90, null)] }, { candles: [c(2025, 120, 130), c(2015, 200, 200)] }, { candles: [] }],
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(b.n).toBe(2);
    expect(b.years.find((y) => y.year === 2025)).toEqual({ year: 2025, n: 2, winRate: 0.5, avgRet: 0.05, avgHighRet: 0.3 });
    expect(b.winRate10).toBeCloseTo(0.6667, 4);
    expect(b.avgRet10).toBeCloseTo(0.0667, 4);
    expect(b.avgHighRet10).toBeCloseTo(0.25, 4);
  });

  it("分割ファイル: 索引と月別に分け、月別は銘柄 1 件を 1 行にして読み戻すと同じ中身になる", () => {
    const row: YutaiListRow = {
      code: "A",
      name: "A",
      minInvest: 1,
      rightsMonths: [3],
      detailUrl: "",
    };
    const bars = new Map<string, MonthBar[]>([
      ["A", [{ year: 2025, month: 2, open: 100, close: 110, high: 120, low: 90 }]],
      ["B", [{ year: 2025, month: 2, open: 100, close: 90, high: 120, low: 90 }]],
    ]);
    const f = buildYutaiFile(
      [
        { month: 3, rows: [row, { ...row, code: "B" }] },
        { month: 4, rows: [] },
      ],
      bars,
      new Date("2026-10-01T00:00:00Z"),
    );
    const { index, months } = splitYutaiFile(f);
    expect(index).toEqual({
      generatedAt: f.generatedAt,
      asOf: "2026-10-01",
      months: { "3": { listedCount: 2, itemCount: 2 }, "4": { listedCount: 0, itemCount: 0 } },
    });
    expect(months.map((m) => m.month)).toEqual([3, 4]);
    expect(months[0]).toEqual({ asOf: "2026-10-01", generatedAt: f.generatedAt, ...f.months["3"] });

    const text = serializeYutaiMonthFile(months[0]);
    expect(JSON.parse(text)).toEqual(months[0]);
    expect(text.split("\n").filter((l) => l.includes('"code"'))).toHaveLength(2);
    expect(text.endsWith("}\n")).toBe(true);
    const empty = serializeYutaiMonthFile(months[1]);
    expect(JSON.parse(empty)).toEqual(months[1]);
    expect(empty).toContain('"items": []');
    expect(JSON.parse(serializeYutaiIndexFile(index))).toEqual(index);
  });

  it("generatedAt だけが違うときは書かない判定になる", () => {
    const a = { generatedAt: "2026-10-01T00:00:00Z", asOf: "2026-10-01", n: 1 };
    expect(sameExceptGeneratedAt(JSON.stringify(a), { ...a, generatedAt: "2026-10-02T00:00:00Z" })).toBe(true);
    expect(sameExceptGeneratedAt(JSON.stringify(a), { ...a, n: 2 })).toBe(false);
    expect(sameExceptGeneratedAt(null, a)).toBe(false);
    expect(sameExceptGeneratedAt("{壊れた", a)).toBe(false);
  });
});
