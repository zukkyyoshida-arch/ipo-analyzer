import { describe, expect, it } from "vitest";
import { buildFinsFile, isFinsStale, normalizeCode, parseFinsFile, toNum } from "./file";
import type { FinsRawRow } from "../../types/fins";

const base = { Code: "12340", CurFYSt: "2025-04-01", CurFYEn: "2026-03-31", NxtFYEn: "2027-03-31" };
const row = (o: Partial<FinsRawRow>): FinsRawRow => ({ DiscDate: "2025-08-01", DiscTime: "15:30:00", ...base, ...o });
const build = (rows: FinsRawRow[]) => buildFinsFile(rows, new Set(["1234"]), "t").items["1234"];

describe("基本", () => {
  it("コード正規化と欠損値", () => {
    expect(normalizeCode("12340")).toBe("1234");
    expect(normalizeCode("1234A")).toBe("1234A");
    expect(toNum("")).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum("12.5")).toBe(12.5);
  });
  it("対象外コードは含めず、asOf は全行の最新開示日", () => {
    const f = buildFinsFile(
      [row({ CurPerType: "1Q", CurPerEn: "2025-06-30", OP: "30", FOP: "100" }), row({ Code: "99990", DiscDate: "2025-09-09" })],
      new Set(["1234"]),
      "t",
    );
    expect(Object.keys(f.items)).toEqual(["1234"]);
    expect(f.asOf).toBe("2025-09-09");
  });
});

describe("進捗率", () => {
  const q1 = row({ CurPerType: "1Q", CurPerEn: "2025-06-30", Sales: "1000", OP: "30", FOP: "100", FSales: "5000" });
  it("1Q は OP/FOP", () => {
    const lq = build([q1])!.latestQuarter!;
    expect(lq.type).toBe("1Q");
    expect(lq.progressOpPct).toBe(30);
    expect(lq.progressSalesPct).toBe(20);
    expect(lq.cumulative).toBeNull();
  });
  it("通期予想の修正を反映（修正のみの行・値は空）", () => {
    const rev = row({ DiscDate: "2025-09-01", CurPerType: "1Q", CurPerEn: "2025-06-30", FOP: "120" });
    const lq = build([q1, rev])!.latestQuarter!;
    expect(lq.progressOpPct).toBe(25);
    expect(lq.discDate).toBe("2025-08-01");
  });
  it("累計の 2Q はそのまま割る", () => {
    const q2 = row({ DiscDate: "2025-11-01", CurPerType: "2Q", CurPerEn: "2025-09-30", Sales: "2200", OP: "70", FOP: "120" });
    const lq = build([q1, q2])!.latestQuarter!;
    expect(lq.cumulative).toBe(true);
    expect(lq.op).toBe(70);
    expect(lq.progressOpPct).toBe(58.3);
  });
  it("単独の 2Q は 1Q を足す", () => {
    const q2 = row({ DiscDate: "2025-11-01", CurPerType: "2Q", CurPerEn: "2025-09-30", Sales: "900", OP: "20", FOP: "100" });
    const lq = build([q1, q2])!.latestQuarter!;
    expect(lq.cumulative).toBe(false);
    expect(lq.op).toBe(50);
    expect(lq.sales).toBe(1900);
    expect(lq.progressOpPct).toBe(50);
  });
  it("予想が 0 以下・欠損なら進捗は null", () => {
    expect(build([row({ CurPerType: "1Q", CurPerEn: "2025-06-30", OP: "30", FOP: "0" })])!.latestQuarter!.progressOpPct).toBeNull();
    expect(build([row({ CurPerType: "1Q", CurPerEn: "2025-06-30", OP: "30" })])!.latestQuarter!.progressOpPct).toBeNull();
  });
});

describe("通期", () => {
  const fy = (end: string, o: Partial<FinsRawRow>) =>
    row({ CurPerType: "FY", CurPerEn: end, CurFYSt: "x", CurFYEn: end, NxtFYEn: undefined, ...o });
  it("最新の期と前期、自己資本比率は % に", () => {
    const r = build([
      fy("2024-03-31", { DiscDate: "2024-05-10", Sales: "800", OP: "50" }),
      fy("2025-03-31", { DiscDate: "2025-05-10", Sales: "1000", OP: "80", NP: "40", EqAR: "0.502", CFO: "90", ShOutFY: "1000000" }),
    ])!;
    expect(r.fy).toMatchObject({ period: "2025-03", sales: 1000, op: 80, eqAR: 50.2, cfo: 90, sharesOutstanding: 1000000 });
    expect(r.prevFy).toEqual({ period: "2024-03", sales: 800, op: 50 });
  });
  it("FY 行の予想は翌期のもの。通期決算後の古い四半期は latestQuarter にしない", () => {
    const r = build([
      row({ CurPerType: "3Q", CurPerEn: "2025-12-31", OP: "70", FOP: "100" }),
      fy("2026-03-31", { DiscDate: "2026-05-10", Sales: "1000", OP: "90", NxtFYEn: "2027-03-31", FOP: "150" }),
    ])!;
    expect(r.latestQuarter).toBeNull();
    expect(r.forecast).toMatchObject({ period: "2027-03", op: 150 });
  });
  it("値の空の FY 行（配当修正など）は通期にしない", () => {
    const r = build([fy("2025-03-31", { Sales: "", OP: "" }), row({ CurPerType: "1Q", CurPerEn: "2025-06-30", OP: "1", FOP: "2" })])!;
    expect(r.fy).toBeNull();
  });
});

describe("検証・鮮度", () => {
  it("parseFinsFile", () => {
    const f = buildFinsFile([row({ CurPerType: "1Q", CurPerEn: "2025-06-30", OP: "30", FOP: "100" })], new Set(["1234"]), "t");
    expect(parseFinsFile(JSON.parse(JSON.stringify(f)))?.items["1234"].code).toBe("1234");
    expect(parseFinsFile({ asOf: "bad", items: {} })).toBeNull();
    expect(parseFinsFile(null)).toBeNull();
  });
  it("isFinsStale は 120 日超で true", () => {
    expect(isFinsStale("2026-01-01", "2026-05-01")).toBe(false); // 120 日ちょうど
    expect(isFinsStale("2026-01-01", "2026-05-02")).toBe(true);
  });
});
