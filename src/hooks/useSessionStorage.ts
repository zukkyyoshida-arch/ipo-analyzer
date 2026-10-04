"use client";

import { useCallback, useEffect, useState } from "react";

/** sessionStorage から JSON を読み、validate を通った値だけ返す（不正・破損・未保存は null）。 */
export function readSession<T>(
  key: string,
  validate: (raw: unknown) => T | null,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * SSR セーフな sessionStorage 永続化フック（詳細ページから戻ったときの画面状態の復元用）。
 * - サーバー及び初回描画は initialValue（ハイドレーション一致）。マウント後に復元する。
 * - validate が null を返す（型不正）場合は initialValue のまま。
 * - 復元完了前の書き込みで保存値を潰さないよう、保存は setter 経由のみ。
 * 戻り値の第3要素 hydrated は復元完了フラグ。
 */
export function useSessionStorage<T>(
  key: string,
  initialValue: T,
  validate: (raw: unknown) => T | null,
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const restored = readSession(key, validate);
    // 外部システム（sessionStorage）との同期であり意図的。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (restored !== null) setValue(restored);
    setHydrated(true);
    // validate は呼び出し側で安定した関数を渡す前提（key 変更時のみ再読込）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setStored = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.sessionStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // 容量超過・利用不可は無視。
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setStored, hydrated];
}

/**
 * スクロール位置を sessionStorage に保存し、ready になったとき復元する。
 * 一覧が描画（件数復元後）されてから呼ばれるよう、ready は hydrated を渡す。
 */
export function useScrollRestore(key: string, ready: boolean): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onScroll() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          window.sessionStorage.setItem(key, String(window.scrollY));
        } catch {
          // 無視。
        }
      }, 100);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    let y = 0;
    try {
      y = Number(window.sessionStorage.getItem(key) ?? 0);
    } catch {
      return;
    }
    if (!Number.isFinite(y) || y <= 0) return;
    // 復元した件数分の描画が済んでから戻す。
    const id = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(id);
  }, [key, ready]);
}
