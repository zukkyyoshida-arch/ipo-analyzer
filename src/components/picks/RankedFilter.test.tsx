import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MoreButton,
  RankCountLine,
  RankFilterBar,
  rankRows,
  usePaged,
  useRankState,
} from "./RankedFilter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

type Row = { code: string; v: number | null; big: boolean; odd: boolean };
const ROWS: Row[] = [
  { code: "a", v: 1, big: false, odd: true },
  { code: "b", v: null, big: true, odd: false },
  { code: "c", v: 5, big: true, odd: true },
  { code: "d", v: 5, big: true, odd: false },
  { code: "e", v: 3, big: false, odd: true },
];
type F = "big" | "odd";
type K = "rank" | "v";
const match = (id: F, r: Row) => r[id];
const value = (r: Row, k: K) => (k === "v" ? r.v : null);

describe("rankRows", () => {
  it("既定ソートでは順序を保ち、1 始まりの順位を付ける", () => {
    const out = rankRows(ROWS, [], match, "rank", "rank", value);
    expect(out.map((r) => [r.item.code, r.rank])).toEqual([
      ["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5],
    ]);
  });

  it("複数フィルタは AND、順位は母集団での順位のまま", () => {
    const out = rankRows(ROWS, ["big", "odd"], match, "rank", "rank", value);
    expect(out.map((r) => [r.item.code, r.rank])).toEqual([["c", 3]]);
    expect(rankRows(ROWS, ["big"], match, "rank", "rank", value).map((r) => r.rank)).toEqual([2, 3, 4]);
  });

  it("並び替えは大きい順・同値は順位順・null は末尾", () => {
    const out = rankRows(ROWS, [], match, "v", "rank", value);
    expect(out.map((r) => r.item.code)).toEqual(["c", "d", "e", "a", "b"]);
    expect(out.map((r) => r.rank)).toEqual([3, 4, 5, 1, 2]);
  });

  it("元の配列を書き換えない", () => {
    const copy = [...ROWS];
    rankRows(ROWS, [], match, "v", "rank", value);
    expect(ROWS).toEqual(copy);
  });
});

describe("RankFilterBar / RankCountLine", () => {
  it("選択中のチップは aria-pressed=true、select は現在の並び順", () => {
    const html = renderToStaticMarkup(
      <RankFilterBar<F, K>
        chips={[{ id: "big", label: "大きい" }, { id: "odd", label: "奇数", title: "説明" }]}
        filters={["odd"]}
        sort="v"
        sortOptions={[{ key: "rank", label: "順位" }, { key: "v", label: "値" }]}
        onToggle={() => {}}
        onClear={() => {}}
        onSort={() => {}}
      />,
    );
    const div = document.createElement("div");
    div.innerHTML = html;
    const btns = [...div.querySelectorAll("button[aria-pressed]")];
    expect(btns.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["大きい", "false"],
      ["奇数", "true"],
    ]);
    expect(btns[1].getAttribute("title")).toBe("説明");
    expect(div.querySelector<HTMLSelectElement>("select")!.value).toBe("v");
  });

  it("クリックと select の変更でコールバックが呼ばれる", () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const onSort = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <RankFilterBar<F, K>
          chips={[{ id: "big", label: "大きい" }]}
          filters={["big"]}
          sort="rank"
          sortOptions={[{ key: "rank", label: "順位" }, { key: "v", label: "値" }]}
          onToggle={onToggle}
          onClear={onClear}
          onSort={onSort}
        />,
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click());
    expect(onToggle).toHaveBeenCalledWith("big");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "解除")!.click());
    expect(onClear).toHaveBeenCalled();
    const sel = container.querySelector("select")!;
    act(() => {
      sel.value = "v";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSort).toHaveBeenCalledWith("v");
    act(() => root.unmount());
  });

  it("件数の行", () => {
    expect(renderToStaticMarkup(<RankCountLine total={10} shown={3} unit="社" note="ルール該当 2 社" />)).toContain(
      "全 10社 → 表示 3社（ルール該当 2 社）",
    );
  });
});

function Paged({ rows }: { rows: number[] }) {
  const [key, setKey] = useState("x");
  const { shown, rest, more } = usePaged(rows, key, 2);
  return (
    <div>
      <ul>{shown.map((n) => <li key={n}>{n}</li>)}</ul>
      <MoreButton rest={rest} onMore={more} pageSize={2} />
      <button type="button" onClick={() => setKey((k) => k + "x")}>切替</button>
    </div>
  );
}

describe("usePaged / MoreButton", () => {
  it("pageSize ずつ増え、resetKey が変わると戻る", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Paged rows={[1, 2, 3, 4, 5]} />));
    const more = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("さらに"));
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(more()!.textContent).toBe("さらに 2 件を見る（残り 3 件）");
    act(() => more()!.click());
    act(() => more()!.click());
    expect(container.querySelectorAll("li")).toHaveLength(5);
    expect(more()).toBeUndefined();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "切替")!.click());
    expect(container.querySelectorAll("li")).toHaveLength(2);
    act(() => root.unmount());
  });
});

function StateProbe({ extra }: { extra?: (id: string) => boolean }) {
  const s = useRankState<F, K>("t.rank", ["big", "odd"], ["rank", "v"], "rank", extra);
  return (
    <div>
      <span data-testid="out">{`${s.filters.join(",")}|${s.sort}`}</span>
      <button type="button" onClick={() => s.toggle("big")}>big</button>
      <button type="button" onClick={() => s.setSort("v")}>sort</button>
      <button type="button" onClick={s.clear}>clear</button>
    </div>
  );
}

describe("useRankState", () => {
  it("localStorage の壊れた値・未知の id を捨て、操作を保存する", async () => {
    window.localStorage.setItem("t.rank.filters", JSON.stringify(["odd", "zzz", 3, "budget"]));
    window.localStorage.setItem("t.rank.sort", JSON.stringify("nope"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<StateProbe />));
    const out = () => container.querySelector('[data-testid="out"]')!.textContent;
    expect(out()).toBe("odd|rank");
    const btn = (t: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === t)!;
    act(() => btn("big").click());
    act(() => btn("sort").click());
    expect(out()).toBe("odd,big|v");
    expect(JSON.parse(window.localStorage.getItem("t.rank.filters")!)).toEqual(["odd", "big"]);
    expect(JSON.parse(window.localStorage.getItem("t.rank.sort")!)).toBe("v");
    act(() => btn("clear").click());
    expect(out()).toBe("|v");
    act(() => root.unmount());

    // extraValid で動的チップを有効にできる
    window.localStorage.setItem("t.rank.filters", JSON.stringify(["budget"]));
    const root2 = createRoot(container);
    await act(async () => root2.render(<StateProbe extra={(id) => id === "budget"} />));
    expect(out()).toBe("budget|v");
    act(() => root2.unmount());
  });
});
