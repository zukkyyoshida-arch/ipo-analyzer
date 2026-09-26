"use client";

import { useEffect, useSyncExternalStore } from "react";
import { generateSyncKey, normalizeSyncKey } from "@/lib/sync/key";
import {
  isSameSyncData,
  mergeSyncData,
  normalizeSyncData,
  stableStringify,
} from "@/lib/sync/merge";
import {
  SYNC_CONFIG_KEY,
  SYNC_KEY_HEADER,
  SYNC_TARGET_KEYS,
  type SyncConfig,
  type SyncData,
  type SyncGetResponse,
} from "@/lib/sync/types";

// 端末間同期（ウォッチ・BB記録・メモ）。状態はモジュール内で 1 つだけ持ち、
// 設定画面と自動同期（useAutoSync）で共有する。同期は「取得 → マージ → 保存」を 1 回ずつ。
// 失敗時はリトライせずエラー表示のみ（次のローカル変更か「今すぐ同期」で再実行）。

/** unset: キー未設定 / idle: 未同期 / syncing: 同期中 / synced: 同期済み / error: 失敗 */
export type SyncStatus = "unset" | "idle" | "syncing" | "synced" | "error";

export interface SyncState {
  hydrated: boolean;
  key: string | null;
  lastSyncedAt: string | null;
  status: SyncStatus;
  error: string | null;
}

const SERVER_STATE: SyncState = {
  hydrated: false,
  key: null,
  lastSyncedAt: null,
  status: "unset",
  error: null,
};

/** 変更後に保存するまでの待ち時間 */
const PUSH_DEBOUNCE_MS = 5000;
/** ローカル変更の検知間隔（localStorage を読んで比べるだけ） */
const POLL_INTERVAL_MS = 2000;

let state: SyncState = SERVER_STATE;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit(next: Partial<SyncState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function readConfig(): SyncConfig | null {
  try {
    const raw = window.localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    const key = normalizeSyncKey(parsed.key);
    if (!key) return null;
    return {
      key,
      lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
      snapshot: parsed.snapshot ? normalizeSyncData(parsed.snapshot) : null,
    };
  } catch {
    return null;
  }
}

function writeConfig(config: SyncConfig | null) {
  try {
    if (config) window.localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    else window.localStorage.removeItem(SYNC_CONFIG_KEY);
  } catch {
    // 容量超過等は無視。
  }
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readLocalData(): SyncData {
  return normalizeSyncData({
    watchlist: readJson(SYNC_TARGET_KEYS.watchlist),
    bb: readJson(SYNC_TARGET_KEYS.bb),
    notes: readJson(SYNC_TARGET_KEYS.notes),
  });
}

/**
 * 変わった項目だけ localStorage に書き、同じタブの useLocalStorage にも storage イベントで知らせる。
 * キーと値の型は既存（useUserData）のまま。
 */
function writeLocalData(next: SyncData, current: SyncData) {
  for (const name of ["watchlist", "bb", "notes"] as const) {
    if (stableStringify(next[name]) === stableStringify(current[name])) continue;
    const key = SYNC_TARGET_KEYS[name];
    const newValue = JSON.stringify(next[name]);
    try {
      window.localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
    } catch {
      // 容量超過等は無視。
    }
  }
}

class SyncApiError extends Error {
  constructor(readonly status: number) {
    super(`sync api ${status}`);
  }
}

function toMessage(error: unknown): string {
  if (error instanceof SyncApiError) {
    if (error.status === 401) return "同期キーの形式が正しくありません。キーを確認してください。";
    if (error.status === 503) return "同期サーバーが準備中です。時間をおいて再度お試しください。";
    if (error.status === 413) return "記録が大きすぎて保存できませんでした。";
    return `同期に失敗しました（${error.status}）。時間をおいて再度お試しください。`;
  }
  if (error instanceof TypeError) return "通信に失敗しました。電波の良い場所で再度お試しください。";
  return "同期に失敗しました。時間をおいて再度お試しください。";
}

// 自動同期が最後に見たローカルデータ（変更検知用）。
let lastSeen: string | null = null;

async function doSync(): Promise<void> {
  const config = readConfig();
  if (!config) return;
  emit({ status: "syncing", error: null });
  try {
    const headers = { [SYNC_KEY_HEADER]: config.key };
    const res = await fetch("/api/sync", { headers, cache: "no-store" });
    if (!res.ok) throw new SyncApiError(res.status);
    const { payload } = (await res.json()) as SyncGetResponse;
    const remote = payload ? normalizeSyncData(payload.data) : null;
    const local = readLocalData();
    const merged = mergeSyncData(config.snapshot ?? null, local, remote);

    if (!isSameSyncData(merged, remote)) {
      const put = await fetch("/api/sync", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ data: merged }),
      });
      if (!put.ok) throw new SyncApiError(put.status);
    }

    // 同期中にキーが差し替わった/解除された場合は結果を捨てる。
    if (readConfig()?.key !== config.key) return;

    // 通信中に端末で編集された項目は、その編集を残す（次回の同期で保存される）。
    const latest = readLocalData();
    const next = isSameSyncData(latest, local) ? merged : mergeSyncData(local, latest, merged);
    const now = new Date().toISOString();
    writeConfig({ key: config.key, lastSyncedAt: now, snapshot: merged });
    lastSeen = stableStringify(next);
    writeLocalData(next, latest);
    emit({ status: "synced", lastSyncedAt: now, error: null });
  } catch (error) {
    if (readConfig()?.key !== config.key) return;
    emit({ status: "error", error: toMessage(error) });
  }
}

/** 今すぐ同期（取得＋保存を 1 回）。同期中なら実行中のものを待つ。 */
export function syncNow(): Promise<void> {
  if (!inflight) {
    inflight = doSync().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function stateFromConfig(config: SyncConfig | null): Partial<SyncState> {
  return {
    hydrated: true,
    key: config?.key ?? null,
    lastSyncedAt: config?.lastSyncedAt ?? null,
    status: config ? (config.lastSyncedAt ? "synced" : "idle") : "unset",
    error: null,
  };
}

function setConfig(config: SyncConfig | null) {
  writeConfig(config);
  emit(stateFromConfig(config));
}

/** 新しい同期キーを作って同期を始める。 */
export function createSyncKey(): Promise<void> {
  setConfig({ key: generateSyncKey(), lastSyncedAt: null, snapshot: null });
  return syncNow();
}

/**
 * 別の端末のキーで同期する。入力キーの記録とこの端末の記録はまとめる（重なる項目はこの端末を優先）。
 * @returns キーの形式が正しければ true
 */
export function enterSyncKey(input: string): boolean {
  const key = normalizeSyncKey(input);
  if (!key) return false;
  setConfig({ key, lastSyncedAt: null, snapshot: null });
  void syncNow();
  return true;
}

/** 同期を解除する（この端末の記録は消さない。サーバーの記録も残る）。 */
export function disconnectSync() {
  setConfig(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!state.hydrated) emit(stateFromConfig(readConfig()));
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SyncState {
  return state;
}

function getServerSnapshot(): SyncState {
  return SERVER_STATE;
}

/** 同期の状態と操作。 */
export function useSync() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...current,
    syncNow,
    createKey: createSyncKey,
    enterKey: enterSyncKey,
    disconnect: disconnectSync,
  };
}

// 自動同期: 起動時に 1 回＋ローカル変更の 5 秒後に 1 回。複数箇所でマウントしても 1 つだけ動かす。
let autoRefs = 0;
let startedOnce = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function checkLocalChange() {
  if (!readConfig()) return;
  const current = stableStringify(readLocalData());
  if (current === lastSeen) return;
  lastSeen = current;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, PUSH_DEBOUNCE_MS);
}

function startAuto() {
  autoRefs += 1;
  if (autoRefs > 1) return;
  lastSeen = stableStringify(readLocalData());
  if (!startedOnce && readConfig()) {
    startedOnce = true;
    void syncNow();
  }
  pollTimer = setInterval(checkLocalChange, POLL_INTERVAL_MS);
}

function stopAuto() {
  autoRefs = Math.max(0, autoRefs - 1);
  if (autoRefs > 0) return;
  if (pollTimer) clearInterval(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  pollTimer = null;
  debounceTimer = null;
}

/** 自動同期を動かす（アプリ全体で 1 か所マウントすれば足りる。重複マウントしても 1 つだけ動く）。 */
export function useAutoSync() {
  useEffect(() => {
    startAuto();
    return stopAuto;
  }, []);
}
