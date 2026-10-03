import { describe, it, expect } from "vitest";
import type { MidItem } from "@/lib/midterm/file";
import {
  buildMidCandidatePayload,
  detectNewMidCandidates,
  midHitCodes,
  parseMidCandidateState,
} from "./midCandidate";
import { payloadsForSubscriber } from "./notify";
import { FORBIDDEN_WORDS, midFile, midItem } from "./fixtures.test-helper";

const TODAY = "2026-10-03";

const noHit = { "40": "2026-08-01", "50": null, "60": null } as MidItem["hits"];

describe("detectNewMidCandidates", () => {
  const file = midFile([midItem("1111"), midItem("2222"), midItem("3333", { hits: noHit, drawdown: -0.45 })]);

  it("初回（前回なし）は送らない", () => {
    expect(detectNewMidCandidates(file, null, TODAY)).toEqual([]);
  });
  it("前回に無い −60% 到達銘柄だけを返す（−60% 未到達は除く）", () => {
    expect(detectNewMidCandidates(file, ["1111"], TODAY).map((i) => i.code)).toEqual(["2222"]);
  });
  it("新規が無ければ空", () => {
    expect(detectNewMidCandidates(file, ["1111", "2222"], TODAY)).toEqual([]);
  });
  it("到達済みコード全件を保存用に返す", () => {
    expect(midHitCodes(file)).toEqual(["1111", "2222"]);
  });
  it("状態の検証: 配列以外は null", () => {
    expect(parseMidCandidateState({})).toBeNull();
    expect(parseMidCandidateState(["1", 2])).toEqual(["1"]);
  });
});

describe("buildMidCandidatePayload", () => {
  it("0 件は null", () => {
    expect(buildMidCandidatePayload([])).toBeNull();
  });
  it("1 件: 銘柄名・コード・下落率・出来高", () => {
    const p = buildMidCandidatePayload([midItem("1111")])!;
    expect(p).toMatchObject({ kind: "midCandidateNew", code: "1111", url: "/?m=mid" });
    expect(p.title).toBe("中長期の新規候補：銘柄1111（1111）");
    expect(p.body).toContain("上場来高値から −62%");
    expect(p.body).toContain("出来高 12万株/日");
  });
  it("出来高が無ければ省く", () => {
    expect(buildMidCandidatePayload([midItem("1111", { avgVolume20: null })])!.body).not.toContain("出来高");
  });
  it("複数は 1 通にまとめ、3 件目以降は「ほか N 件」・本文 120 文字以内", () => {
    const items = ["1111", "2222", "3333", "4444"].map((c) => midItem(c, { name: "長い名前の銘柄".repeat(3) }));
    const p = buildMidCandidatePayload(items)!;
    expect(p.code).toBe("mid");
    expect(p.title).toBe("中長期の新規候補 4件");
    expect(p.body).toContain("ほか2件");
    expect(p.body.length).toBeLessThanOrEqual(120);
  });
  it("2 件は両方の名前を載せる", () => {
    const p = buildMidCandidatePayload([midItem("1111"), midItem("2222")])!;
    expect(p.body).toBe("銘柄1111（1111）、銘柄2222（2222）");
  });
  it("売買を促す語を含まない", () => {
    const p = buildMidCandidatePayload([midItem("1111"), midItem("2222")])!;
    const q = buildMidCandidatePayload([midItem("1111")])!;
    for (const w of FORBIDDEN_WORDS) expect(p.title + p.body + q.title + q.body).not.toContain(w);
  });
});

describe("payloadsForSubscriber（中長期の新規候補）", () => {
  it("ウォッチ外でも通し、enabledKinds が無ければ落とす", () => {
    const p = buildMidCandidatePayload([midItem("1111")])!;
    expect(payloadsForSubscriber([p], { enabledKinds: ["midCandidateNew"], watchedCodes: [] })).toHaveLength(1);
    expect(payloadsForSubscriber([p], { enabledKinds: ["bbStart"], watchedCodes: ["1111"] })).toHaveLength(0);
  });
});
