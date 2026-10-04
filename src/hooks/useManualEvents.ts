"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { MANUAL_EVENTS_STORAGE_KEY, parseManualEvents, type ManualEvent } from "@/lib/calendar/events";

// 売買カレンダーの手動の予定を端末の localStorage に持つフック。
// サーバーへの保存・端末間同期はしない（D1 の書き込みを増やさないため）。

/** 一覧の行 id。 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY: unknown[] = [];

/** 売買カレンダーの手動の予定。 */
export function useManualEvents() {
  const [raw, setRaw, hydrated] = useLocalStorage<unknown>(MANUAL_EVENTS_STORAGE_KEY, EMPTY);
  const events = useMemo(() => parseManualEvents(raw), [raw]);

  const saveEvent = useCallback(
    (e: ManualEvent) =>
      setRaw((prev: unknown) => {
        const list = parseManualEvents(prev);
        return list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e];
      }),
    [setRaw],
  );

  const removeEvent = useCallback(
    (id: string) => setRaw((prev: unknown) => parseManualEvents(prev).filter((x) => x.id !== id)),
    [setRaw],
  );

  return { events, saveEvent, removeEvent, hydrated };
}
