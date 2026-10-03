import { describe, expect, it } from "vitest";
import {
  buildMarginFile,
  findAsOf,
  isMarginStale,
  marginRatio,
  normalizeCode,
  parseMarginFile,
  parseSignedNumber,
} from "./file";

// JPX の PDF を行ごとに分けたセル配列（実物の先頭付近を縮めたもの）
const rows: string[][] = [
  ["2026/10/1 申込み現在", "東京証券取引所株式部", "2026/10/2"],
  ["B", "サカタのタネ", "普通株式", "プライム", "貸", "13770", "JP3315000004 株数 Shs.", "23,800", "1,000", "0.1%", "45,300", "400", "0.1%", "12,100", "0"],
  ["SAKATA SEED", "Prime", "Loan", "13770", "JP3315000004 金額 Val.", "100,866,114", "4,302,000", "-"],
  ["B", "Ｃｏｃｏｌｉｖｅ", "普通株式", "グロース", "制", "137A0", "JP3297390001 株数 Shs.", "0", "0", "0.0%", "102,400", "▲ 9,800", "3.3%"],
  ["B", "極洋", "13010", "JP3257200000 株数 Shs.", "8,800", "▲ 200", "0.1%", "157,700", "1,100", "1.3%"],
  ["Cocolive,Inc.", "137A0", "JP3297390001 金額 Val.", "0", "0"],
];

describe("parseSignedNumber / normalizeCode", () => {
  it("▲ は負、* と - は null", () => {
    expect(parseSignedNumber("▲ 1,200")).toBe(-1200);
    expect(parseSignedNumber("3,900")).toBe(3900);
    expect(parseSignedNumber("*")).toBeNull();
    expect(parseSignedNumber("-")).toBeNull();
  });
  it("5 桁の末尾 0 を 4 桁に", () => {
    expect(normalizeCode("13010")).toBe("1301");
    expect(normalizeCode("137A0")).toBe("137A");
    expect(normalizeCode("1301")).toBe("1301");
    expect(normalizeCode("ABC")).toBeNull();
  });
});

describe("buildMarginFile", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  it("基準日と株数行の買残・売残・前日比から前回残高を逆算する（金額行は読まない）", () => {
    expect(findAsOf(rows)).toBe("2026-10-01");
    const f = buildMarginFile(rows, "https://example.test/x.pdf", now)!;
    expect(f.asOf).toBe("2026-10-01");
    expect(Object.keys(f.items).sort()).toEqual(["1301", "1377", "137A"]);
    expect(f.items["1377"]).toEqual({ buy: 45300, sell: 23800, buyPrev: 44900, sellPrev: 22800 });
    expect(f.items["137A"]).toEqual({ buy: 102400, sell: 0, buyPrev: 112200, sellPrev: 0 });
    expect(f.items["1301"].sellPrev).toBe(9000);
  });
  it("対象コードだけ残す", () => {
    const f = buildMarginFile(rows, "u", now, new Set(["1377"]))!;
    expect(Object.keys(f.items)).toEqual(["1377"]);
  });
  it("様式が変わって株数行が読めない・基準日が無いときは null", () => {
    expect(buildMarginFile([["2026/10/1 申込み現在"], ["x"]], "u", now)).toBeNull();
    expect(buildMarginFile(rows.slice(1), "u", now)).toBeNull();
  });
});

describe("parseMarginFile / isMarginStale / marginRatio", () => {
  it("壊れた入力は null、items の不正な行は捨てる", () => {
    expect(parseMarginFile(null)).toBeNull();
    const f = parseMarginFile({
      generatedAt: "t",
      asOf: "2026-10-01",
      sourceUrl: "u",
      items: { "1377": { buy: 1, sell: 2 }, bad: { buy: "x" } },
    })!;
    expect(Object.keys(f.items)).toEqual(["1377"]);
    expect(f.items["1377"].buyPrev).toBeNull();
  });
  it("14 日を超えたら stale", () => {
    expect(isMarginStale("2026-10-01", "2026-10-15")).toBe(false);
    expect(isMarginStale("2026-10-01", "2026-10-16")).toBe(true);
  });
  it("出来高が null/0 なら比率は null", () => {
    expect(marginRatio(1000, 100)).toBe(10);
    expect(marginRatio(1000, null)).toBeNull();
    expect(marginRatio(1000, 0)).toBeNull();
  });
});
