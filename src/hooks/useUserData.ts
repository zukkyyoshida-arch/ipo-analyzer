"use client";

import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type {
  BbEntry,
  BbState,
  NotesState,
  WatchlistState,
} from "@/types/userData";
import type { BbStatus } from "@/types/broker";

const WATCHLIST_KEY = "ipo-analyzer:watchlist:v1";
const BB_KEY = "ipo-analyzer:bb:v1";
const NOTES_KEY = "ipo-analyzer:notes:v1";

// ウォッチリストの永続化フック。
export function useWatchlist() {
  const [watchlist, setWatchlist, hydrated] =
    useLocalStorage<WatchlistState>(WATCHLIST_KEY, []);

  const isWatched = useCallback(
    (code: string) => watchlist.includes(code),
    [watchlist],
  );

  const toggle = useCallback(
    (code: string) => {
      setWatchlist((prev) =>
        prev.includes(code)
          ? prev.filter((c) => c !== code)
          : [...prev, code],
      );
    },
    [setWatchlist],
  );

  return { watchlist, isWatched, toggle, hydrated };
}

// BB 申込状況の永続化フック。
export function useBbState() {
  const [bbState, setBbState, hydrated] = useLocalStorage<BbState>(BB_KEY, {});

  const getEntry = useCallback(
    (code: string, brokerId: string): BbEntry => {
      return bbState[code]?.[brokerId] ?? { status: "none" };
    },
    [bbState],
  );

  const setStatus = useCallback(
    (code: string, brokerId: string, status: BbStatus) => {
      setBbState((prev) => {
        const forCode = { ...(prev[code] ?? {}) };
        forCode[brokerId] = { ...(forCode[brokerId] ?? {}), status };
        return { ...prev, [code]: forCode };
      });
    },
    [setBbState],
  );

  const setMemo = useCallback(
    (code: string, brokerId: string, memo: string) => {
      setBbState((prev) => {
        const forCode = { ...(prev[code] ?? {}) };
        const existing = forCode[brokerId] ?? { status: "none" };
        forCode[brokerId] = { ...existing, memo };
        return { ...prev, [code]: forCode };
      });
    },
    [setBbState],
  );

  return { bbState, getEntry, setStatus, setMemo, hydrated };
}

// 銘柄メモの永続化フック。
export function useNotes() {
  const [notes, setNotes, hydrated] = useLocalStorage<NotesState>(
    NOTES_KEY,
    {},
  );

  const getNote = useCallback((code: string) => notes[code] ?? "", [notes]);

  const setNote = useCallback(
    (code: string, text: string) => {
      setNotes((prev) => ({ ...prev, [code]: text }));
    },
    [setNotes],
  );

  return { notes, getNote, setNote, hydrated };
}
