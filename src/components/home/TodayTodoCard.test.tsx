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

  const NO_LOCKUP = { days: 0, hasPriceRelease: false, coverage: 0 };

  it("今日・明日も未来の予定も無ければ1行の空状態", () => {
    const c = mount([
      makeIpo({ bbPeriod: { start: "2026-09-01", end: "2026-09-05" }, listingDate: "2026-09-20", lockup: NO_LOCKUP }),
    ]);
    expect(c.textContent).toContain("今日のやること");
    expect(c.textContent).toContain("今日の予定はありません");
    expect(c.textContent).not.toContain("次の予定");
  });

  it("今日・明日の予定が無ければ、最も近い未来の予定を「次の予定」として銘柄詳細へのリンク付きで出す", () => {
    // 2026-11-22（日）時点で、NOTA の BB 開始は 11/24（火）・あと2日
    const nota = makeIpo({
      code: "673A",
      name: "NOTA",
      bbPeriod: { start: "2026-11-24", end: "2026-11-27" },
      listingDate: "2026-12-08",
      lockup: NO_LOCKUP,
    });
    const later = makeIpo({ code: "700A", name: "後の銘柄", bbPeriod: { start: "2026-11-30", end: "2026-12-04" }, listingDate: "", lockup: NO_LOCKUP });
    const c = mount([later, nota], "2026-11-22");
    expect(c.textContent).not.toContain("今日の予定はありません");
    const rows = [...c.querySelectorAll("li")];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("次の予定");
    expect(rows[0].textContent).toContain("11/24（火）");
    expect(rows[0].textContent).toContain("NOTA");
    expect(rows[0].textContent).toContain("BB開始・あと2日");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/ipo/673A");
    expect(rows[0].querySelectorAll("button")).toHaveLength(0);
  });

  it("次の予定が来年なら年付きで出す", () => {
    const ipo = makeIpo({ code: "800A", name: "年明け", bbPeriod: { start: "2027-01-08", end: "2027-01-14" }, listingDate: "", lockup: NO_LOCKUP });
    const c = mount([ipo], "2026-12-28");
    expect(c.textContent).toContain("2027/1/8（金）");
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
