import type { MidItem, MidFile } from "@/lib/midterm/file";
import type { PushNotificationPayload } from "@/types/push";
import { PUSH_EVENT_LABELS } from "@/lib/push/notify";

// 中長期セカンダリの「新規候補」通知（純関数）。朝の Cron が midterm.json を前回保存分と比べて使う。
// 条件 = 上場来高値から −60% に初めて届いた（hits["60"] が入っている）銘柄。
// ウォッチリスト外も対象（候補を見つけるための通知）。文言は参考情報に限り、売買を促さない。

/** 通知に載せる銘柄名の最大数（3 件目以降は「ほか N 件」）。 */
const MAX_NAMED = 2;
/** 本文の最大文字数。 */
const MAX_BODY_LENGTH = 120;

/** −60% 到達済み（hits["60"] あり）の銘柄コード全件。次回の差分比較用に保存する。 */
export function midHitCodes(file: MidFile): string[] {
  return file.items.filter((i) => i.hits["60"] !== null).map((i) => i.code);
}

/** KV から読んだ値を前回のコード集合として検証する。壊れていれば null（初回扱い）。 */
export function parseMidCandidateState(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((c): c is string => typeof c === "string");
}

/**
 * 新たに −60% へ届いた銘柄。previousCodes が null（初回）なら空配列
 * （過去分を一気に通知しない。呼び出し側は状態だけ保存する）。
 */
export function detectNewMidCandidates(
  file: MidFile,
  previousCodes: readonly string[] | null,
  todayIso: string,
): MidItem[] {
  if (previousCodes === null) return [];
  const before = new Set(previousCodes);
  // 基準日が未来（時計ずれ）の異常データは送らない。
  if (file.asOf > todayIso) return [];
  return file.items.filter((i) => i.hits["60"] !== null && !before.has(i.code));
}

function manShares(volume: number): string {
  const man = volume / 10_000;
  return man >= 10 ? `${Math.round(man)}` : `${Math.round(man * 10) / 10}`;
}

function describeOne(item: MidItem): string {
  const pct = Math.abs(Math.round(item.drawdown * 100));
  const volume = item.avgVolume20 !== null ? `・出来高 ${manShares(item.avgVolume20)}万株/日` : "";
  return `上場来高値から −${pct}%${volume}（参考情報）`;
}

/** 1 件ならその銘柄、複数なら 1 通にまとめる。items が空なら null。 */
export function buildMidCandidatePayload(
  items: readonly MidItem[],
): PushNotificationPayload | null {
  const label = PUSH_EVENT_LABELS.midCandidateNew;
  const url = "/?m=mid";
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [item] = items;
    return {
      kind: "midCandidateNew",
      code: item.code,
      url,
      title: `${label}：${item.name}（${item.code}）`,
      body: describeOne(item),
    };
  }
  const named = items.slice(0, MAX_NAMED).map((i) => `${i.name}（${i.code}）`);
  const rest = items.length - named.length;
  let body = named.join("、") + (rest > 0 ? ` ほか${rest}件` : "");
  if (body.length > MAX_BODY_LENGTH) body = `${body.slice(0, MAX_BODY_LENGTH - 1)}…`;
  return {
    kind: "midCandidateNew",
    code: "mid",
    url,
    title: `${label} ${items.length}件`,
    body,
  };
}
