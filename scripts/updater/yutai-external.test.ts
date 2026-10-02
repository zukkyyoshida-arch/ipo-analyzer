import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { YutaiItem, YutaiMonth } from "../../src/lib/yutai/types";
import { parseYutaiMonthFile } from "../../src/lib/yutai/file";
import { parseYutaiDetail } from "./yutai-detail";
import { excelSerialToIso, nextEarningsByCode, parseEarningsXlsx, parseEarningsXlsxLinks } from "./yutai-earnings";
import { applyExternal, earningsWindow, targetMonths } from "./yutai-external";
import { pickProfitTrend, pickYahooEarningsDate } from "./yutai-yahoo";
import { serializeYutaiMonthFile } from "./yutai";

const fx = (n: string) => path.join(__dirname, "__fixtures__", n);
const detailHtml = readFileSync(fx("daiwair-yutai-detail-9553.html"), "utf-8");

describe("大和IR 銘柄詳細ページのパース", () => {
  it("業種を取り、注記が無ければ active（「変更の可能性有」は変更扱いにしない）", () => {
    const d = parseYutaiDetail(detailHtml);
    expect(d.sector).toBe("サービス業");
    expect(d.status).toBe("active");
    expect(d.note).toBeNull();
  });

  it("優待に関する適時開示の見出しに「廃止」があれば abolished", () => {
    const html = detailHtml.replace("特定子会社の異動(解散及び清算)に関するお知らせ", "株主優待制度の廃止に関するお知らせ");
    const d = parseYutaiDetail(html);
    expect(d.status).toBe("abolished");
    expect(d.note).toContain("廃止");
  });

  it("優待に関する見出しの「拡充」「変更」は changed。優待と関係ない見出しの「変更」は無視", () => {
    const changed = parseYutaiDetail(detailHtml.replace("特定子会社の異動(解散及び清算)に関するお知らせ", "株主優待制度の一部変更に関するお知らせ"));
    expect(changed.status).toBe("changed");
    const other = parseYutaiDetail(detailHtml.replace("特定子会社の異動(解散及び清算)に関するお知らせ", "定款の一部変更に関するお知らせ"));
    expect(other.status).toBe("active");
  });

  it("優待内容の本文に廃止の注記があれば abolished。開始年は書かれていれば取る", () => {
    const html = detailHtml.replace(
      "800株以上",
      "※2026年3月末をもって株主優待制度を廃止します。2019年に優待制度を導入。<br>800株以上",
    );
    const d = parseYutaiDetail(html);
    expect(d.status).toBe("abolished");
    expect(d.since).toBe(2019);
  });
});

describe("JPX 決算発表予定日", () => {
  it("ページから xlsx のリンクを絶対 URL で取る", () => {
    const links = parseEarningsXlsxLinks(readFileSync(fx("jpx-financial-announcement.html"), "utf-8"));
    expect(links).toHaveLength(3);
    expect(links[0]).toBe(
      "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/tvdivq0000001ofb-att/kessan.xlsx",
    );
  });

  it("Excel のシリアルを日付にする", () => {
    expect(excelSerialToIso(46300)).toBe("2026-10-05");
    expect(excelSerialToIso(3)).toBeNull();
  });

  it("xlsx から行を読み、銘柄ごとに今日以降で最も早い日を選ぶ", () => {
    const rows = parseEarningsXlsx(readFileSync(fx("jpx-kessan-sample.xlsx")));
    expect(rows).toEqual([
      { code: "2753", date: "2026-10-05", name: "あみやき亭", sector: "小売業", kind: "第２四半期" },
    ]);
    const m = nextEarningsByCode(
      [
        { code: "1111", date: "2026-09-01", name: "", sector: "", kind: "" },
        { code: "1111", date: "2026-11-10", name: "", sector: "", kind: "" },
        { code: "1111", date: "2026-10-20", name: "", sector: "", kind: "" },
        { code: "2222", date: "2026-09-01", name: "", sector: "", kind: "" },
      ],
      "2026-10-02",
    );
    expect(m.get("1111")).toBe("2026-10-20");
    expect(m.has("2222")).toBe(false);
  });
});

describe("Yahoo の決算まわり", () => {
  const row = (date: string, v: Record<string, number>) => ({ date, periodType: "3M", ...v });

  it("営業利益の前年同期比で増益／減益を出す。前年が赤字なら比率は null", () => {
    const up = pickProfitTrend([
      row("2025-06-30", { operatingIncome: 100 }),
      row("2025-09-30", { operatingIncome: 90 }),
      row("2026-06-30", { operatingIncome: 120 }),
    ]);
    expect(up).toEqual({ profitTrend: "up", profitAsOf: "2026-06-30", profitChange: 0.2, profitBasis: "operating" });
    const down = pickProfitTrend([row("2025-06-30", { operatingIncome: 100 }), row("2026-06-30", { operatingIncome: 80 })]);
    expect(down.profitTrend).toBe("down");
    const red = pickProfitTrend([row("2025-06-30", { operatingIncome: -10 }), row("2026-06-30", { operatingIncome: 5 })]);
    expect(red.profitTrend).toBe("up");
    expect(red.profitChange).toBeNull();
  });

  it("営業利益が無ければ純利益、それも無ければ 1 株利益。前年同期が無ければ全部 null", () => {
    expect(pickProfitTrend([row("2025-06-30", { dilutedEPS: 25 }), row("2026-06-30", { dilutedEPS: 27 })]).profitBasis).toBe("eps");
    expect(pickProfitTrend([row("2025-06-30", { netIncome: 5 }), row("2026-06-30", { netIncome: 4 })]).profitBasis).toBe("net");
    expect(pickProfitTrend([row("2026-06-30", { operatingIncome: 1 })])).toEqual({
      profitTrend: null, profitAsOf: null, profitChange: null, profitBasis: null,
    });
    expect(pickProfitTrend([])).toEqual({ profitTrend: null, profitAsOf: null, profitChange: null, profitBasis: null });
  });

  it("calendarEvents の earningsDate は JST の日付にし、今日より前は捨てる", () => {
    expect(pickYahooEarningsDate(["2026-11-05T06:30:00.000Z", "2026-10-01T00:00:00.000Z"], "2026-10-02")).toBe("2026-11-05");
    expect(pickYahooEarningsDate([], "2026-10-02")).toBeNull();
    expect(pickYahooEarningsDate(undefined, "2026-10-02")).toBeNull();
  });
});

function item(code: string, extra: Partial<YutaiItem> = {}): YutaiItem {
  return {
    code, name: `社${code}`, minInvest: 100000, rightsMonths: [11], detailUrl: "", candles: [],
    up10: 6, n10: 10, up5: 3, n5: 5, avgRet10: 0.01, avgHighRet10: 0.05, price: 1000, high12: 1200, low12: 800,
    ...extra,
  };
}

describe("外部ソースの適用と除外ルール", () => {
  const month = (items: YutaiItem[]): YutaiMonth => ({
    month: 11, prevMonth: 10, listUrl: "", listedCount: items.length, items, baseline: null,
  });

  it("11 月権利の期間は 10 月最初の営業日〜権利付最終日", () => {
    expect(earningsWindow(11, "2026-10-02")).toEqual({ from: "2026-10-01", to: "2026-11-26" });
    // 権利付最終日を過ぎていれば来年
    expect(earningsWindow(11, "2026-12-01").from.slice(0, 4)).toBe("2027");
  });

  it("期間中に決算発表がある銘柄・廃止銘柄を除外し、除外数と中身を残す", () => {
    const out = applyExternal(
      month([item("1001"), item("1002"), item("1003"), item("1004")]),
      {
        detail: new Map([
          ["1001", { sector: "小売業", status: "active", note: null, since: 2015 }],
          ["1003", { sector: "化学", status: "abolished", note: "優待を廃止", since: null }],
        ]),
        earnings: new Map([
          ["1001", { date: "2026-12-20", source: "jpx" as const }], // 期間の外
          ["1002", { date: "2026-11-10", source: "yahoo" as const }], // 期間の中
          ["1004", { date: "2026-09-30", source: "jpx" as const }], // 過去
        ]),
      },
      "2026-10-02",
    );
    expect(out.items.map((i) => i.code)).toEqual(["1001", "1004"]);
    expect(out.items[0]).toMatchObject({ sector: "小売業", yutaiStatus: "active", yutaiSince: 2015, nextEarningsDate: "2026-12-20", earningsSource: "jpx" });
    expect(out.excludedEarnings).toBe(1);
    expect(out.excludedAbolished).toBe(1);
    expect(out.excludedItems).toEqual([
      { code: "1002", name: "社1002", reason: "earnings", earningsDate: "2026-11-10" },
      { code: "1003", name: "社1003", reason: "abolished" },
    ]);
  });

  it("再適用では前回の除外を引き継ぐ。取れなかった項目は前回の値が残る", () => {
    const first = applyExternal(month([item("1002")]), { earnings: new Map([["1002", { date: "2026-11-10", source: "jpx" as const }]]) }, "2026-10-02");
    const second = applyExternal({ ...first, items: [item("1005", { nextEarningsDate: "2026-12-01", earningsSource: "jpx" })] }, {}, "2026-10-03");
    expect(second.excludedEarnings).toBe(1);
    expect(second.items[0].nextEarningsDate).toBe("2026-12-01");
  });

  it("書き出して読み直せる（空の外部項目は書かない）", () => {
    const m = applyExternal(
      month([item("1001"), item("1002")]),
      {
        detail: new Map([["1001", { sector: "小売業", status: "changed" as const, note: "優待を拡充", since: null }]]),
        profit: new Map([["1001", { profitTrend: "up" as const, profitAsOf: "2026-06-30", profitChange: 0.12, profitBasis: "operating" as const }]]),
        earnings: new Map([["1002", { date: "2026-11-10", source: "jpx" as const }]]),
      },
      "2026-10-02",
    );
    const text = serializeYutaiMonthFile({ ...m, asOf: "2026-10-01", generatedAt: "2026-10-02T00:00:00.000Z" });
    expect(text).not.toContain("yutaiSince");
    const back = parseYutaiMonthFile(JSON.parse(text))!;
    expect(back.items[0]).toMatchObject({ yutaiStatus: "changed", yutaiNote: "優待を拡充", profitTrend: "up", profitChange: 0.12 });
    expect(back.excludedItems).toEqual([{ code: "1002", name: "社1002", reason: "earnings", earningsDate: "2026-11-10" }]);
    expect(back.excludedEarnings).toBe(1);
  });

  it("日次更新の対象月は今月＋1 と今月＋2（年またぎ含む）", () => {
    expect(targetMonths("2026-10-02")).toEqual([11, 12]);
    expect(targetMonths("2026-11-15")).toEqual([12, 1]);
    expect(targetMonths("2026-12-31")).toEqual([1, 2]);
  });
});
