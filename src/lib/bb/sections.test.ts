import { describe, expect, it } from "vitest";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import { bbSectionOf, groupBbSections } from "./sections";

const TODAY = "2026-11-22";

describe("bbSectionOf", () => {
  it("BB 終了日が今日以降なら BB中・これから（今日が最終日も含む）", () => {
    expect(bbSectionOf(makeIpo({ bbPeriod: { start: "2026-11-24", end: "2026-11-27" } }), TODAY)).toBe("active");
    expect(bbSectionOf(makeIpo({ bbPeriod: { start: "2026-11-18", end: "2026-11-22" } }), TODAY)).toBe("active");
  });

  it("BB 終了済みで、購入期間の終了日か上場日が今日以降なら抽選・購入待ち", () => {
    const base = { bbPeriod: { start: "2026-11-10", end: "2026-11-14" } };
    expect(
      bbSectionOf(makeIpo({ ...base, purchasePeriod: { start: "2026-11-18", end: "2026-11-22" }, listingDate: "" }), TODAY),
    ).toBe("waiting");
    expect(
      bbSectionOf(makeIpo({ ...base, purchasePeriod: { start: "2026-11-17", end: "2026-11-20" }, listingDate: "2026-11-25" }), TODAY),
    ).toBe("waiting");
    expect(
      bbSectionOf(makeIpo({ ...base, purchasePeriod: { start: "", end: "" }, listingDate: "2026-11-22" }), TODAY),
    ).toBe("waiting");
  });

  it("BB・購入期間・上場日がすべて過ぎたら終了（例: TOKIUM の BB 11/09〜11/13・購入〜11/20）", () => {
    const tokium = makeIpo({
      bbPeriod: { start: "2026-11-09", end: "2026-11-13" },
      purchasePeriod: { start: "2026-11-17", end: "2026-11-20" },
      listingDate: "2026-11-21",
    });
    expect(bbSectionOf(tokium, TODAY)).toBe("ended");
    expect(
      bbSectionOf(makeIpo({ bbPeriod: { start: "2026-11-01", end: "2026-11-05" }, purchasePeriod: { start: "", end: "" }, listingDate: "" }), TODAY),
    ).toBe("ended");
  });

  it("BB 日程が未取得なら、上場日が過ぎていない限り BB中・これから", () => {
    const noBb = { bbPeriod: { start: "", end: "" } };
    expect(bbSectionOf(makeIpo({ ...noBb, listingDate: "" }), TODAY)).toBe("active");
    expect(bbSectionOf(makeIpo({ ...noBb, listingDate: "2026-12-10" }), TODAY)).toBe("active");
    expect(bbSectionOf(makeIpo({ ...noBb, listingDate: "2026-11-01" }), TODAY)).toBe("ended");
  });

  it("BB 終了日が無く開始日だけなら開始日で判定する", () => {
    expect(bbSectionOf(makeIpo({ bbPeriod: { start: "2026-11-25", end: "" } }), TODAY)).toBe("active");
  });
});

describe("groupBbSections", () => {
  it("3区分を固定の順で返し、区分内は BB 開始日の昇順（未取得は末尾）、0件の区分は返さない", () => {
    const nota = makeIpo({ code: "673A", bbPeriod: { start: "2026-11-24", end: "2026-11-27" }, listingDate: "2026-12-08" });
    const open = makeIpo({ code: "670A", bbPeriod: { start: "2026-11-19", end: "2026-11-25" }, listingDate: "2026-12-03" });
    const unknown = makeIpo({ code: "690A", bbPeriod: { start: "", end: "" }, listingDate: "" });
    const tokium = makeIpo({
      code: "650A",
      bbPeriod: { start: "2026-11-09", end: "2026-11-13" },
      purchasePeriod: { start: "2026-11-17", end: "2026-11-20" },
      listingDate: "2026-11-21",
    });
    const sections = groupBbSections([tokium, nota, unknown, open], TODAY);
    expect(sections.map((s) => [s.id, s.label, s.ipos.map((i) => i.code)])).toEqual([
      ["active", "BB中・これから", ["670A", "673A", "690A"]],
      ["ended", "終了", ["650A"]],
    ]);
  });

  it("銘柄が無ければ空配列", () => {
    expect(groupBbSections([], TODAY)).toEqual([]);
  });
});
