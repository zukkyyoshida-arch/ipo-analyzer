"use client";

import { useCallback, useEffect, useState } from "react";

// SSR セーフな localStorage 永続化フック。
// - サーバー及び初回クライアントレンダリングでは initialValue を使い、ハイドレーション不整合を避ける。
// - マウント後に localStorage を読み込み、値を反映する。
// - 別タブでの変更（storage イベント）にも追従する。
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  // マウント後に localStorage から一度だけ読み込みハイドレートする。
  // SSR と初回レンダリングでは initialValue を使うため、ここでの setState は
  // 外部システム（localStorage）との同期であり意図的。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // 破損データ等は無視して initialValue のまま。
    }
    setHydrated(true);
  }, [key]);

  const setStored = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: T) => T)(prev)
            : next;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            // 容量超過等は無視。
          }
        }
        return resolved;
      });
    },
    [key],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // 無視。
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return [value, setStored, hydrated];
}
