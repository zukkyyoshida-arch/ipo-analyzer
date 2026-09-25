"use client";

import { useCallback, useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type ThemeMode = "auto" | "dark" | "light";

const STORAGE_KEY = "ipo-analyzer:theme:v1";

/**
 * テーマモード（"auto"|"dark"|"light"）を localStorage に永続化し、
 * `<html data-theme>` へ反映するSSRセーフなフック。
 * 初期描画のちらつき防止用の同期スクリプトは layout.tsx の<head>側で別途行う。
 */
export function useTheme() {
  const [mode, setMode, hydrated] = useLocalStorage<ThemeMode>(
    STORAGE_KEY,
    "auto",
  );

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (mode === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", mode);
    }
  }, [mode, hydrated]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setMode(next);
    },
    [setMode],
  );

  return { mode, setTheme, hydrated };
}
