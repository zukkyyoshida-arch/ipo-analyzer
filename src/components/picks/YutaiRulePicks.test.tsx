import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PickItem, PicksFile } from "@/lib/yutai/picksRules";
import { YUTAI_RULE_PICKS_NOTE, YutaiRulePicks } from "./YutaiRulePicks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-06";

function pick(code: string, o: Partial<PickItem> = {}): PickItem {
  return {
    code,
    name: `銘柄${code}`,
    n: 13,
    win: 10,
    avg: 0.067,
    worst: -0.23,
    streak: 3,
    price: 1500,
    priceAsOf: "2026-10-02",
    invest: 150_000,
    minInvest: 150_000,
    aboveMa75: true,
    pos12: 0.5,
    ret1m: -0.02,
    sector: "小売業",
    nextEarningsDate: "2026-11-10",
    detailUrl: `https://example.com/${code}`,
    rules: ["C", "D"],
    ...o,
  };
}

function file(o: Partial<PicksFile> = {}): PicksFile {
  return {
    generatedAt: "",
    asOf: "2026-10-06",
    marketRet1m: -0.016,
    marketDown: true,
    months: [
      {
        month: 12,
        year: 2026,
        lastCumDate: "2026-12-28",
        entryDays: 56,
        matched: 21,
        items: [pick("1111"), pick("2222", { invest: 90_000, aboveMa75: false, rules: ["B", "C"], nextEarningsDate: null, detailUrl: null })],
      },
      { month: 1, year: 2027, lastCumDate: "2027-01-27", entryDays: 75, matched: 0, items: [] },
    ],
    note: { perTradeMax: 0.77, basketB: 0.85, basketC: 0.83, basketD: 0.76 },
    ...o,
  };
}

function stubFetch(body: unknown | null, status = 200) {
  const fn = vi.fn(async () =>
    body === null ? new Response("", { status: 404 }) : new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** 注記は ⓘ に退避している。押すとシートに出ること。 */
function expectNoteInHint(container: HTMLElement) {
  const btn = container.querySelector<HTMLButtonElement>('button[aria-label="説明を見る"]');
  expect(btn).not.toBeNull();
  act(() => btn!.click());
  expect(document.body.textContent).toContain(YUTAI_RULE_PICKS_NOTE);
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<YutaiRulePicks todayIso={TODAY} />));
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("YutaiRulePicks", () => {
  it("picks.json を取り、市場条件・月の見出し・成績・ルールのチップ・注記を出す", async () => {
    const fetchFn = stubFetch(file());
    const { container } = await mount();
    expect(fetchFn).toHaveBeenCalledWith("/data/yutai/picks.json");
    const text = container.textContent ?? "";
    expect(text).toContain("同時期の過去成績ランキング");
    expect(text).toContain("直近1か月の優待銘柄中央値 −1.6% → 市場条件 成立");
    expect(text).toContain("12月権利（権利付最終日 12/28、今が約56営業日前）");
    expect(text).toContain("10/13勝・平均+6.7%・最悪−23%・3連勝中");
    expect(text).toContain("100株 15万円・75日線の上・決算 11/10");
    expect(text).toContain("C: 過去70%×20万以下×市場↓");
    expect(text).toContain("D: 過去80%(8年)×20万以下");
    expect(text).toContain("B: 過去70%×10万以下×75日線下×市場↓");
    expect(text).toContain("75日線の下");
    expect(text).toContain("成績あり 2 社 → 表示 2 社（ルール該当 21 社）");
    expect(text).toContain("1位");
    expect(text).toContain("2位");
    expect(text).toContain("1月権利");
    expect(text).toContain("過去の成績がある銘柄はありません");
    expect(text).not.toContain(YUTAI_RULE_PICKS_NOTE);
    expectNoteInHint(container);
    // 決算が期間中なら注意の色
    expect(container.querySelector(".text-warn")?.textContent).toContain("決算 11/10（期間中）");
    // 社名は大和IR の詳細へ（/ipo/ には飛ばさない）
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "銘柄1111")!;
    expect(link.getAttribute("href")).toBe("https://example.com/1111");
    expect(container.querySelector('a[href^="/ipo/"]')).toBeNull();
  });

  it("チップで絞れる・解除で戻る・条件ゼロなら空表示", async () => {
    window.localStorage.clear();
    const items = [
      pick("1111", { win: 13, rules: ["D"] }),
      pick("2222", { win: 10, rules: [] }),
      pick("3333", { win: 8, rules: [] }),
    ];
    stubFetch(file({ months: [{ month: 12, year: 2026, lastCumDate: "2026-12-28", entryDays: 56, matched: 3, items }] }));
    const { container } = await mount();
    const chip = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent === label)!;
    expect(container.textContent).toContain("成績あり 3 社 → 表示 3 社（ルール該当 3 社）");
    act(() => chip("勝率80%以上").click());
    expect(chip("勝率80%以上").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("成績あり 3 社 → 表示 1 社");
    act(() => chip("勝率80%以上").click());
    act(() => chip("勝率70%以上").click());
    expect(container.textContent).toContain("表示 2 社");
    act(() => chip("決算またぎを除く").click());
    act(() => chip("100株10万円以下").click());
    expect(container.textContent).toContain("条件に当てはまる銘柄はありません");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "解除")!.click());
    expect(container.textContent).toContain("表示 3 社");
    // 並び替えても順位の数字は既定順のまま
    const sel = container.querySelector("select")!;
    act(() => {
      sel.value = "avg";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("3位");
  });

  it("30 件ずつ表示し、「さらに見る」で増える", async () => {
    window.localStorage.clear();
    const items = Array.from({ length: 65 }, (_, i) => pick(String(1000 + i), { rules: [] }));
    stubFetch(file({ months: [{ month: 12, year: 2026, lastCumDate: "2026-12-28", entryDays: 56, matched: 0, items }] }));
    const { container } = await mount();
    expect(container.querySelectorAll("ol > li")).toHaveLength(30);
    const more = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("さらに"))!;
    expect(more().textContent).toContain("残り 35 件");
    act(() => more().click());
    expect(container.querySelectorAll("ol > li")).toHaveLength(60);
    act(() => more().click());
    expect(container.querySelectorAll("ol > li")).toHaveLength(65);
    expect(container.textContent).toContain("65位");
  });

  it("市場がプラスなら不成立", async () => {
    stubFetch(file({ marketRet1m: 0.012, marketDown: false }));
    const { container } = await mount();
    expect(container.textContent).toContain("+1.2% → 市場条件 不成立");
  });

  it("picks.json が無い・古いときは更新待ち（注記は出す）", async () => {
    stubFetch(null);
    const a = await mount();
    expect(a.container.textContent).toContain("更新待ち");
    expectNoteInHint(a.container);
    await a.unmount();
    document.body.innerHTML = "";

    stubFetch(file({ asOf: "2026-09-29" }));
    const b = await mount();
    expect(b.container.textContent).toContain("更新待ち");
    expect(b.container.textContent).toContain("前回の作成: 9/29");
    expect(b.container.textContent).not.toContain("市場条件");
  });

  it("通信に失敗しても更新待ち", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const { container } = await mount();
    expect(container.textContent).toContain("更新待ち");
  });
});
