import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate, isExceeded, monthRange, parseLimit, run } from "./check-usage";

const rows = [
  { sum: { requests: 100 }, dimensions: { scriptName: "apollo-ipo" } },
  { sum: { requests: 50 }, dimensions: { scriptName: "apollo-ipo" } },
  { sum: { requests: 700 }, dimensions: { scriptName: "other" } },
];

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const ok = (r: unknown[]) => ({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: r }] } } });
const env = { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" };
const now = new Date("2026-10-15T12:34:56Z");

describe("純粋関数", () => {
  it("期間は UTC 今月 1 日 0 時から現在まで", () => {
    expect(monthRange(now)).toEqual({ since: "2026-10-01T00:00:00.000Z", until: "2026-10-15T12:34:56.000Z" });
  });
  it("scriptName ごとに集計して多い順に並べる", () => {
    expect(aggregate(rows)).toEqual({ byScript: [["other", 700], ["apollo-ipo", 150]], total: 850 });
  });
  it("しきい値ちょうどは超過にしない", () => {
    expect(isExceeded(9_000_000, 9_000_000)).toBe(false);
    expect(isExceeded(9_000_001, 9_000_000)).toBe(true);
  });
  it("USAGE_GUARD_LIMIT の既定と不正値", () => {
    expect(parseLimit(undefined)).toBe(9_000_000);
    expect(parseLimit("100")).toBe(100);
    expect(() => parseLimit("abc")).toThrow();
  });
});

describe("run", () => {
  it("未満は 0、超過は 2 を返し GITHUB_OUTPUT に書く", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "guard-"));
    const out = path.join(dir, "out");
    try {
      const logs: string[] = [];
      expect(await run({ ...env, USAGE_GUARD_LIMIT: "1000" }, now, mockFetch(ok(rows)), (m) => logs.push(m))).toBe(0);
      expect(
        await run({ ...env, USAGE_GUARD_LIMIT: "800", GITHUB_OUTPUT: out }, now, mockFetch(ok(rows)), () => {}),
      ).toBe(2);
      const text = readFileSync(out, "utf8");
      expect(text).toContain("total=850");
      expect(text).toContain("exceeded=true");
      expect(logs.join("\n")).toContain("apollo-ipo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("API エラー・HTTP エラー・環境変数欠落は 1", async () => {
    const q = () => {};
    expect(await run(env, now, mockFetch({ errors: [{ message: "denied" }] }), q)).toBe(1);
    expect(await run(env, now, mockFetch({}, 500), q)).toBe(1);
    expect(await run({}, now, mockFetch(ok([])), q)).toBe(1);
  });
});
