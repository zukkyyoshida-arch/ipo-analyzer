import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./config";
import { jstParts } from "./yutai";

// 優待の外部ソース（大和IR の詳細ページ・Yahoo の決算まわり）の「同じ暦月（JST）なら使い回す」キャッシュ。
// scripts/updater/.cache/<dir>/<code>.json に { fetchedAt, value } で保存する。

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 外部ソースへのリクエスト間隔（ミリ秒）。 */
export const EXTERNAL_INTERVAL_MS = 1000;

export function cacheDir(name: string): string {
  return path.join(CACHE_DIR, name);
}

interface Cached<T> {
  fetchedAt: string;
  value: T;
}

/** 同じ暦月（JST）のキャッシュ（保存時刻 fetchedAt と now が同じ年月）か、週単位の鮮度（maxAgeDays）で判定する。 */
function fresh(fetchedAt: string, now: Date, maxAgeDays?: number): boolean {
  const t = new Date(fetchedAt);
  if (Number.isNaN(t.getTime())) return false;
  if (maxAgeDays !== undefined) return now.getTime() - t.getTime() < maxAgeDays * 86_400_000;
  const a = jstParts(t);
  const b = jstParts(now);
  return a.year === b.year && a.month === b.month;
}

export async function readCache<T>(dirName: string, code: string, now: Date, maxAgeDays?: number): Promise<T | undefined> {
  try {
    const c = JSON.parse(await readFile(path.join(cacheDir(dirName), `${code}.json`), "utf-8")) as Cached<T>;
    if (c && typeof c.fetchedAt === "string" && fresh(c.fetchedAt, now, maxAgeDays)) return c.value;
  } catch {
    // 無ければ取りに行く
  }
  return undefined;
}

export async function writeCache<T>(dirName: string, code: string, now: Date, value: T): Promise<void> {
  await mkdir(cacheDir(dirName), { recursive: true });
  const body: Cached<T> = { fetchedAt: now.toISOString(), value };
  await writeFile(path.join(cacheDir(dirName), `${code}.json`), JSON.stringify(body), "utf-8");
}

/**
 * codes を順に fetcher で取る（キャッシュがあれば使い、取りに行ったときだけ 1 秒あける。失敗は null で続行）。
 * 戻りは code → value（取れなかった銘柄は入らない）。
 */
export async function loadAllCached<T>(
  dirName: string,
  codes: string[],
  now: Date,
  fetcher: (code: string) => Promise<T>,
  opts: { label: string; maxAgeDays?: number } = { label: dirName },
): Promise<{ values: Map<string, T>; count: { cache: number; fetched: number }; failed: string[] }> {
  const values = new Map<string, T>();
  const count = { cache: 0, fetched: 0 };
  const failed: string[] = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const cached = await readCache<T>(dirName, code, now, opts.maxAgeDays);
    if (cached !== undefined) {
      values.set(code, cached);
      count.cache++;
    } else {
      let ok = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt > 0) await sleep(3000 * attempt);
        try {
          const v = await fetcher(code);
          values.set(code, v);
          await writeCache(dirName, code, now, v);
          count.fetched++;
          ok = true;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!ok) {
        failed.push(code);
        console.warn(`  ${opts.label}を取得できずスキップ: ${code} — ${(lastErr as Error)?.message}`);
      }
      await sleep(EXTERNAL_INTERVAL_MS);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${opts.label} ${i + 1}/${codes.length}（取得 ${count.fetched}・失敗 ${failed.length}）`);
  }
  return { values, count, failed };
}
