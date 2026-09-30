import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDelimited } from "./csv";
import { decodeCsvBytes, parseHoldingCsv, parseHoldingCsvZip } from "./holdingsCsv";
import { readZipEntries } from "./zip";

// fixture は 2026-09-30 に EDINET API v2（type=5）で取った実物の CSV を、使う要素の行だけに絞ったもの。
// 形式（UTF-16LE・BOM・タブ区切り・全項目クォート・CRLF・コンテキスト ID）は実物のまま。
// 個人の提出者は氏名と EDINET コードを架空のものに置き換えてある。
const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

describe("readZipEntries", () => {
  it("EDINET の ZIP（Deflate）から CSV を取り出せる", () => {
    const entries = readZipEntries(fixture("lvh-new-single.zip"));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toMatch(/^XBRL_TO_CSV\/jplvh010000-lvh-001_E\d{5}-000_.*\.csv$/);
    // UTF-16LE の BOM
    expect([...entries[0].data.subarray(0, 2)]).toEqual([0xff, 0xfe]);
  });

  it("ZIP でないものは例外", () => {
    expect(() => readZipEntries(Buffer.from("not a zip at all, definitely not"))).toThrow();
    expect(() => readZipEntries(Buffer.alloc(3))).toThrow();
  });
});

describe("parseDelimited", () => {
  it("クォート内の区切り文字・改行・二重クォートを扱う", () => {
    const rows = parseDelimited('"a","b, c"\r\n"d ""e""","f\ng"\n\nh,i', ",");
    expect(rows).toEqual([
      ["a", "b, c"],
      ['d "e"', "f\ng"],
      ["h", "i"],
    ]);
  });

  it("先頭の BOM は捨てる", () => {
    expect(parseDelimited('﻿"x"\t"y"', "\t")).toEqual([["x", "y"]]);
  });
});

describe("decodeCsvBytes", () => {
  it("BOM で UTF-16LE と UTF-8 を見分ける", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("保有割合", "utf16le")]);
    expect(decodeCsvBytes(utf16)).toBe("保有割合");
    expect(decodeCsvBytes(Buffer.from("﻿保有", "utf8"))).toBe("保有");
    expect(decodeCsvBytes(Buffer.from("保有", "utf8"))).toBe("保有");
  });
});

describe("parseHoldingCsvZip（実データ）", () => {
  it("大量保有報告書・提出者 1 名: 合計の行が無いので提出者の値を使う。割合は小数", () => {
    const r = parseHoldingCsvZip(fixture("lvh-new-single.zip"));
    expect(r).toMatchObject({
      schema: "010000",
      issuerName: "株式会社ミンカブ・ジ・インフォノイド",
      issuerSecCode: "4436",
      filer: "株式会社NTTデータ",
      holders: 1,
      ratio: 0.1638,
      prevRatio: null,
      shares: 2517800,
      purpose: "発行者との資本業務提携を目的とした保有",
      proposal: false,
      reason: "",
      obligationDate: "2026-09-17",
      filingDate: "2026-09-29",
      amendmentOf: null,
    });
  });

  it("変更報告書・共同保有者 3 名: 合計（FilingDateInstant）の割合を使い、保有目的は重複を除いてつなぐ", () => {
    const r = parseHoldingCsvZip(fixture("lvh-change-joint.zip"));
    expect(r.holders).toBe(3);
    expect(r.ratio).toBe(0.1604);
    expect(r.prevRatio).toBe(0.1646);
    expect(r.shares).toBe(2465800);
    expect(r.filer).toBe("SBIインベストメント株式会社");
    expect(r.reason).toBe("株券等に関する担保契約等重要な契約の締結及び保有目的の変更");
    const parts = r.purpose.split("／");
    expect(parts).toHaveLength(3);
    expect(parts[0].length).toBeLessThanOrEqual(60);
    expect(parts[1]).toBe("発行者との業務提携、純投資");
    expect(parts[2]).toBe("純投資");
    // 重要提案行為等の欄は「該当事項なし」
    expect(r.proposal).toBe(false);
  });

  it("訂正報告書: 訂正前の docID と、表紙の提出日（訂正前の提出日）を読む", () => {
    const r = parseHoldingCsvZip(fixture("lvh-amendment-individual.zip"));
    expect(r.amendmentOf).toBe("S100Z0YQ");
    expect(r.filingDate).toBe("2026-09-24");
    expect(r.issuerSecCode).toBe("623A");
    expect(r.ratio).toBe(0.6676);
    expect(r.prevRatio).toBeNull();
    expect(r.filer).toBe("山田 太郎");
  });

  it("短期大量譲渡（旧様式・jplvh020000）: 前回割合の行が無くても読める", () => {
    const r = parseHoldingCsvZip(fixture("lvh-bulk-transfer-individual.zip"));
    expect(r.schema).toBe("020000");
    expect(r.ratio).toBe(0.0043);
    expect(r.prevRatio).toBeNull();
    expect(r.reason).toBe("株式保有割合が1%以上減少したこと");
    expect(r.obligationDate).toBe("2026-04-15");
  });
});

describe("parseHoldingCsv（組み立てた CSV）", () => {
  const header = '"要素ID"\t"項目名"\t"コンテキストID"\t"相対年度"\t"連結・個別"\t"期間・時点"\t"ユニットID"\t"単位"\t"値"';
  const row = (id: string, ctx: string, v: string) =>
    [`jplvh_cor:${id}`, "x", ctx, "提出日時点", "その他", "時点", "pure", "", v].map((c) => `"${c}"`).join("\t");
  const h = (n: number) => `FilingDateInstant_jplvh010000-lvh_E00000-000FilerLargeVolumeHolder${n}Member`;

  it("合計の行が無く共同保有者が複数なら、各人の値を足す", () => {
    const text = [
      header,
      row("HoldingRatioOfShareCertificatesEtc", h(1), "0.03"),
      row("HoldingRatioOfShareCertificatesEtc", h(2), "0.025"),
      row("TotalNumberOfStocksEtcHeld", h(1), "100"),
      row("TotalNumberOfStocksEtcHeld", h(2), "50"),
    ].join("\r\n");
    const r = parseHoldingCsv(text);
    expect(r.ratio).toBeCloseTo(0.055, 10);
    expect(r.shares).toBe(150);
  });

  it("重要提案行為等に中身があれば proposal、「－」「該当事項なし」は false", () => {
    const base = [header, row("HoldingRatioOfShareCertificatesEtc", "FilingDateInstant", "0.06")];
    const withProposal = parseHoldingCsv(
      [...base, row("ActOfMakingImportantProposalEtc", h(1), "株主提案権の行使を予定")].join("\r\n"),
    );
    expect(withProposal.proposal).toBe(true);
    const none = parseHoldingCsv(
      [...base, row("ActOfMakingImportantProposalEtc", h(1), "該当事項なし"), row("ActOfMakingImportantProposalEtc", h(2), "－")].join("\r\n"),
    );
    expect(none.proposal).toBe(false);
  });

  it("割合が％の数値で入っていたら小数に直し、範囲外や「－」は null", () => {
    const pct = parseHoldingCsv([header, row("HoldingRatioOfShareCertificatesEtc", "FilingDateInstant", "16.38")].join("\n"));
    expect(pct.ratio).toBeCloseTo(0.1638, 10);
    const dash = parseHoldingCsv([header, row("HoldingRatioOfShareCertificatesEtc", "FilingDateInstant", "－")].join("\n"));
    expect(dash.ratio).toBeNull();
    const broken = parseHoldingCsv([header, row("HoldingRatioOfShareCertificatesEtc", "FilingDateInstant", "12345")].join("\n"));
    expect(broken.ratio).toBeNull();
  });

  it("空の CSV でも落ちない", () => {
    const r = parseHoldingCsv(header);
    expect(r).toMatchObject({ ratio: null, prevRatio: null, shares: null, purpose: "", filer: "", holders: null });
  });
});
