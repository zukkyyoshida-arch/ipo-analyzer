"use client";

import { useEffect } from "react";

/**
 * production環境でのみ Service Worker（/sw.js）を登録する。UI要素は持たない。
 */
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録失敗は無視（オフライン対応が使えないだけで機能自体は動く）。
    });
  }, []);

  return null;
}
