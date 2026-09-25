import { describe, it, expect } from "vitest";
import {
  EDINET_SEARCH_URL,
  JPX_NEW_LISTING_URL,
  buildExternalLinks,
  isValidSecuritiesCode,
  kabutanDisclosureUrl,
  kabutanStockUrl,
} from "./links";

describe("isValidSecuritiesCode", () => {
  it("4桁数字と英字入り新形式を通し、それ以外は弾く", () => {
    expect(isValidSecuritiesCode("7203")).toBe(true);
    expect(isValidSecuritiesCode("130A")).toBe(true);
    expect(isValidSecuritiesCode("TEST")).toBe(false);
    expect(isValidSecuritiesCode("123")).toBe(false);
    expect(isValidSecuritiesCode("12345")).toBe(false);
    expect(isValidSecuritiesCode("12&4")).toBe(false);
  });
});

describe("kabutan URL", () => {
  it("銘柄ページと適時開示の URL を組み立てる", () => {
    expect(kabutanStockUrl("7203")).toBe("https://kabutan.jp/stock/?code=7203");
    expect(kabutanDisclosureUrl("130a")).toBe("https://kabutan.jp/stock/news?code=130A&b=k");
  });
  it("不正なコードは null", () => {
    expect(kabutanStockUrl("abc")).toBeNull();
    expect(kabutanDisclosureUrl("")).toBeNull();
  });
});

describe("buildExternalLinks", () => {
  it("記事URLありなら5件を固定順で返す", () => {
    const links = buildExternalLinks("5588", "https://kabu.96ut.com/article/ipo/2026035/");
    expect(links.map((l) => l.id)).toEqual([
      "kabutan-stock",
      "kabutan-disclosure",
      "jpx-new-listing",
      "edinet",
      "96ut-article",
    ]);
    expect(links.find((l) => l.id === "jpx-new-listing")?.url).toBe(JPX_NEW_LISTING_URL);
    expect(links.find((l) => l.id === "edinet")?.url).toBe(EDINET_SEARCH_URL);
    expect(links[4].url).toBe("https://kabu.96ut.com/article/ipo/2026035/");
  });
  it("記事URLが無い・http(s)以外なら 96ut を省く", () => {
    expect(buildExternalLinks("5588").map((l) => l.id)).not.toContain("96ut-article");
    expect(buildExternalLinks("5588", "javascript:alert(1)").map((l) => l.id)).not.toContain(
      "96ut-article",
    );
  });
  it("コード不正なら kabutan を省き JPX・EDINET は残す", () => {
    expect(buildExternalLinks("TEST").map((l) => l.id)).toEqual(["jpx-new-listing", "edinet"]);
  });
});
