import { readFile, writeFile } from "node:fs/promises";

// JSON の読み書きヘルパ。変更検出（内容が同じなら書かない）を行う。

/** JSON ファイルを読む。存在しない/壊れている場合はフォールバック値を返す。 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 内容に変更がある場合のみ書き込む。
 * 戻り値: 実際に書き込んだら true、変更なしでスキップなら false。
 */
export async function writeJsonIfChanged(
  filePath: string,
  data: unknown,
): Promise<boolean> {
  const next = JSON.stringify(data, null, 2) + "\n";
  let current: string | null = null;
  try {
    current = await readFile(filePath, "utf-8");
  } catch {
    current = null;
  }
  if (current === next) return false;
  await writeFile(filePath, next, "utf-8");
  return true;
}
