// Cloudflare Workers の今月のリクエスト数（アカウント全体）を数え、しきい値超えを検知する番人。
// 終了コード: 0=未満 / 2=超過 / 1=API エラー。GITHUB_OUTPUT があれば total / exceeded を書く。
import { appendFileSync } from "node:fs";

export const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
export const DEFAULT_LIMIT = 9_000_000;

export const QUERY = `query($accountTag:String!,$since:Time!,$until:Time!){ viewer { accounts(filter:{accountTag:$accountTag}) {
  workersInvocationsAdaptive(limit:10000, filter:{datetime_geq:$since, datetime_leq:$until}) { sum { requests } dimensions { scriptName } }
} } }`;

export type InvocationRow = {
  sum?: { requests?: number | null } | null;
  dimensions?: { scriptName?: string | null } | null;
};

/** Cloudflare の請求月は UTC 基準。今月 1 日 00:00:00Z から現在まで。 */
export function monthRange(now: Date): { since: string; until: string } {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { since: since.toISOString(), until: now.toISOString() };
}

/** scriptName ごとに合計し、件数の多い順に並べる。 */
export function aggregate(rows: InvocationRow[]): { byScript: [string, number][]; total: number } {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = r.dimensions?.scriptName || "(不明)";
    map.set(name, (map.get(name) ?? 0) + (r.sum?.requests ?? 0));
  }
  const byScript = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return { byScript, total: byScript.reduce((s, [, n]) => s + n, 0) };
}

export function isExceeded(total: number, limit: number): boolean {
  return total > limit;
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`USAGE_GUARD_LIMIT が不正です: ${raw}`);
  return n;
}

export async function fetchRows(
  token: string,
  accountId: string,
  range: { since: string; until: string },
  fetchImpl: typeof fetch = fetch,
): Promise<InvocationRow[]> {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { accountTag: accountId, ...range } }),
  });
  if (!res.ok) throw new Error(`GraphQL API が HTTP ${res.status} を返しました`);
  const json = (await res.json()) as {
    data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: InvocationRow[] }[] } };
    errors?: { message?: string }[] | null;
  };
  if (json.errors?.length) {
    throw new Error(`GraphQL エラー: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const account = json.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("アカウントのデータが返りませんでした（トークン権限・アカウント ID を確認）");
  return account.workersInvocationsAdaptive ?? [];
}

export function formatReport(byScript: [string, number][], total: number, limit: number): string {
  const pct = ((total / limit) * 100).toFixed(1);
  const head = `今月のリクエスト合計 ${total.toLocaleString("en-US")} / しきい値 ${limit.toLocaleString("en-US")}（${pct}%）→ ${isExceeded(total, limit) ? "超過" : "未満"}`;
  const lines = byScript.map(([n, c]) => `${n.padEnd(32)} ${c.toLocaleString("en-US").padStart(14)}`);
  return [head, "", `${"scriptName".padEnd(32)} ${"requests".padStart(14)}`, ...lines].join("\n");
}

export async function run(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
  log: (m: string) => void = console.log,
): Promise<number> {
  try {
    const token = env.CLOUDFLARE_API_TOKEN;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !accountId) throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が未設定です");
    const limit = parseLimit(env.USAGE_GUARD_LIMIT);
    const rows = await fetchRows(token, accountId, monthRange(now), fetchImpl);
    const { byScript, total } = aggregate(rows);
    const exceeded = isExceeded(total, limit);
    log(formatReport(byScript, total, limit));
    if (env.GITHUB_OUTPUT) {
      appendFileSync(env.GITHUB_OUTPUT, `total=${total}\nlimit=${limit}\nexceeded=${exceeded}\n`);
    }
    return exceeded ? 2 : 0;
  } catch (e) {
    log(`番人のエラー: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && /check-usage\.ts$/.test(process.argv[1])) {
  run(process.env).then((code) => process.exit(code));
}
