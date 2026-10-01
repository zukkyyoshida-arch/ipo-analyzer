"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
  PORTFOLIO_STORAGE_KEY,
  PRICE_CACHE_STORAGE_KEY,
  parseHoldings,
  parsePriceCache,
  type Holding,
  type PriceCache,
  type PriceQuote,
} from "@/lib/portfolio/types";
import { mergePrice } from "@/lib/portfolio/judge";
import { MANUAL_EVENTS_STORAGE_KEY, parseManualEvents, type ManualEvent } from "@/lib/calendar/events";

// 保有中リスト・現在値・売買カレンダーの手動の予定を端末の localStorage に持つフック。
// サーバーへの保存・端末間同期はしない（D1 の書き込みを増やさないため）。

/** 一覧の行 id。 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY: unknown[] = [];
const EMPTY_CACHE: Record<string, unknown> = {};

/** 保有の一覧と、取得した現在値の置き場。 */
export function usePortfolio() {
  const [rawHoldings, setRawHoldings, hydrated] = useLocalStorage<unknown>(PORTFOLIO_STORAGE_KEY, EMPTY);
  const [rawPrices, setRawPrices] = useLocalStorage<unknown>(PRICE_CACHE_STORAGE_KEY, EMPTY_CACHE);
  const holdings = useMemo(() => parseHoldings(rawHoldings), [rawHoldings]);
  const prices = useMemo(() => parsePriceCache(rawPrices), [rawPrices]);

  /** id が同じなら置き換え、無ければ足す。 */
  const saveHolding = useCallback(
    (h: Holding) =>
      setRawHoldings((prev: unknown) => {
        const list = parseHoldings(prev);
        return list.some((x) => x.id === h.id) ? list.map((x) => (x.id === h.id ? h : x)) : [...list, h];
      }),
    [setRawHoldings],
  );

  const removeHolding = useCallback(
    (id: string) => setRawHoldings((prev: unknown) => parseHoldings(prev).filter((x) => x.id !== id)),
    [setRawHoldings],
  );

  /** 取得した現在値をまとめて入れる（古い値では上書きしない）。 */
  const putPrices = useCallback(
    (quotes: Record<string, PriceQuote>) =>
      setRawPrices((prev: unknown) => {
        let cache: PriceCache = parsePriceCache(prev);
        for (const [code, q] of Object.entries(quotes)) cache = mergePrice(cache, code, q);
        return cache;
      }),
    [setRawPrices],
  );

  return { holdings, prices, saveHolding, removeHolding, putPrices, hydrated };
}

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
