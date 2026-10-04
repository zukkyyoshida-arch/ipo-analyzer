import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readSession, useSessionStorage } from "./useSessionStorage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const isNum = (r: unknown) => (typeof r === "number" ? r : null);

type Api = { value: number; set: (v: number) => void; hydrated: boolean };

function mount(key: string): Api {
  const api = {} as Api;
  function Probe() {
    const [value, set, hydrated] = useSessionStorage(key, 1, isNum);
    api.value = value;
    api.set = set;
    api.hydrated = hydrated;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return api;
}

describe("useSessionStorage", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => window.sessionStorage.clear());

  it("保存値を復元する", () => {
    window.sessionStorage.setItem("k", "7");
    const api = mount("k");
    expect(api.value).toBe(7);
    expect(api.hydrated).toBe(true);
  });

  it("不正値・破損JSONは既定にフォールバックする", () => {
    window.sessionStorage.setItem("k", '"abc"');
    expect(mount("k").value).toBe(1);
    window.sessionStorage.setItem("k2", "{broken");
    expect(readSession("k2", isNum)).toBeNull();
  });

  it("setter で保存される", () => {
    const api = mount("k");
    act(() => api.set(5));
    expect(window.sessionStorage.getItem("k")).toBe("5");
    expect(api.value).toBe(5);
  });
});
