import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, type BarPoint } from "./BarChart";

function render(points: BarPoint[], props: { signed?: boolean; integer?: boolean } = {}) {
  return renderToStaticMarkup(
    <BarChart
      points={points}
      formatTick={(v) => `${v}%`}
      formatValue={(v) => `${v.toFixed(1)}%`}
      ariaLabel="テスト用のグラフ"
      {...props}
    />,
  );
}

/** 棒の height 指定（style="...height:XX%"）を全部取り出す。 */
function barHeights(html: string): string[] {
  return [...html.matchAll(/max-width:24px[^"]*?;height:([^;"]+)/g)].map((m) => m[1]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BarChart の描画", () => {
  it("NaN / Infinity の期間は棒を描かず、style にも表にも NaN・Infinity を出さない", () => {
    const html = render([
      { label: "1月", value: 10, note: "上場なし" },
      { label: "2月", value: Number.NaN, note: "算出不可" },
      { label: "3月", value: Infinity },
      { label: "4月", value: -Infinity },
      { label: "5月", value: 20 },
    ]);
    expect(html).not.toMatch(/NaN|Infinity/);
    // 値のある 2 期間だけ棒が出る
    expect(barHeights(html)).toHaveLength(2);
    // 読み上げ用の表は null と同じ扱い（note があればそれ、無ければ「値なし」）
    expect(html).toContain("算出不可");
    expect(html).toContain("値なし");
  });

  it("有限な値が 1 つも無ければ、グラフではなく空表示になる", () => {
    const html = render([
      { label: "1月", value: Number.NaN },
      { label: "2月", value: Infinity },
    ]);
    expect(html).toContain("この期間のデータはありません");
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("1e-7 や 1e-15 だけでも、目盛りが重複せず（key 警告なし）、棒は 0 の印として基準線上に出る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = render([
      { label: "1月", value: 1e-7 },
      { label: "2月", value: -1e-15 },
      { label: "3月", value: 0 },
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(html).not.toMatch(/NaN|Infinity|\de-\d/);
    // 縦軸の目盛りは 0 と上端の 2 本以上、全部 0 ではない
    const ticks = [...html.matchAll(/tabular-nums text-subtle[^>]*style="top:[^"]*">([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(new Set(ticks).size).toBeGreaterThanOrEqual(2);
    // 3 本とも 0 として同じ長さ（0%）の印になり、枠外（bottom:100% など）に出ない
    const heights = barHeights(html);
    expect(heights).toHaveLength(3);
    for (const h of heights) expect(h).toBe("0%");
    expect(html).not.toContain("bottom:100%");
  });
});
