import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { makeIpo } from "@/lib/checkpoints/fixtures.test-helper";
import { TodayTodoCard } from "./TodayTodoCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BB_KEY = "ipo-analyzer:bb:v1";

function mount(ipos = [makeIpo()], todayIso = "2026-10-21") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TodayTodoCard ipos={ipos} todayIso={todayIso} />));
  return container;
}

describe("TodayTodoCard", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("今日・明日の予定が無ければ1行の空状態", () => {
    const c = mount([makeIpo({ bbPeriod: { start: "2026-09-01", end: "2026-09-05" }, listingDate: "2026-09-20" })]);
    expect(c.textContent).toContain("今日のやること");
    expect(c.textContent).toContain("今日の予定はありません");
  });

  it("BB 締切の行は銘柄詳細へのリンクと、主幹事でのワンタップ記録を出す", () => {
    const ipo = makeIpo({
      code: "652A",
      name: "トグルHD",
      bbPeriod: { start: "2026-10-15", end: "2026-10-21" },
      listingDate: "2026-11-02",
      leadUnderwriter: "SBI証券",
    });
    const listed = makeIpo({ code: "640A", name: "上場銘柄", bbPeriod: { start: "", end: "" }, listingDate: "2026-10-22" });
    const c = mount([ipo, listed]);
    const rows = [...c.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("今日");
    expect(rows[0].textContent).toContain("BB締切");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/ipo/652A");
    expect(rows[0].textContent).toContain("SBI証券");
    expect([...rows[0].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["申込済", "当選", "補欠", "落選"]);
    // 上場の行には記録ボタンを出さない
    expect(rows[1].textContent).toContain("明日");
    expect(rows[1].textContent).toContain("上場");
    expect(rows[1].querySelectorAll("button")).toHaveLength(0);

    const applied = rows[0].querySelectorAll("button")[0];
    act(() => applied.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(JSON.parse(window.localStorage.getItem(BB_KEY) ?? "{}")["652A"].sbi.status).toBe("applied");
    expect(c.querySelectorAll("li")[0].querySelectorAll("button")[0].getAttribute("aria-pressed")).toBe("true");

    // もう一度押すと未対応に戻す
    act(() => c.querySelectorAll("li")[0].querySelectorAll("button")[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(JSON.parse(window.localStorage.getItem(BB_KEY) ?? "{}")["652A"].sbi.status).toBe("none");
  });
});
