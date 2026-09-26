"use client";

import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Section } from "@/components/ui/Section";
import { useAutoSync, useSync, type SyncStatus } from "@/hooks/useSync";
import { formatSyncKey, maskSyncKey } from "@/lib/sync/key";

const BUTTON =
  "min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-text active:opacity-80 disabled:opacity-40";
const PRIMARY_BUTTON =
  "min-h-11 rounded-xl border border-accent bg-accent px-4 text-sm font-semibold text-on-accent active:opacity-80 disabled:opacity-40";

/** ISO 日時を端末の時刻で「HH:mm」に整形する。 */
function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusChip(status: SyncStatus, lastSyncedAt: string | null): { tone: ChipTone; label: string } {
  switch (status) {
    case "unset":
      return { tone: "neutral", label: "未設定" };
    case "idle":
      return { tone: "neutral", label: "未同期" };
    case "syncing":
      return { tone: "accent", label: "同期中…" };
    case "synced":
      return { tone: "up", label: `同期済み ${formatTime(lastSyncedAt)}` };
    case "error":
      return { tone: "down", label: "エラー" };
  }
}

/** 自動同期（起動時 1 回＋変更の 5 秒後）だけを動かす描画なしのコンポーネント。レイアウトに 1 つ置く。 */
export function SyncAutoRunner() {
  useAutoSync();
  return null;
}

/**
 * 端末間同期の設定セクション。同期キー（端末で生成した 32 文字）を他の端末に入力すると、
 * ウォッチ・BB記録・メモを同じ内容に揃える。サーバーはキーのハッシュだけを保存する。
 */
export function SyncSection() {
  useAutoSync();
  const { hydrated, key, lastSyncedAt, status, error, syncNow, createKey, enterKey, disconnect } =
    useSync();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [entering, setEntering] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const chip = statusChip(status, lastSyncedAt);
  const busy = status === "syncing";

  async function copyKey() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード非対応時は「表示」から手で写してもらう。
      setRevealed(true);
    }
  }

  function submitKey(e: FormEvent) {
    e.preventDefault();
    if (key && input.replace(/[\s-]/g, "").toUpperCase() === key) {
      setInputError("この端末と同じキーです。");
      return;
    }
    if (!enterKey(input)) {
      setInputError("キーの形式が正しくありません（英数字32文字）。");
      return;
    }
    setInput("");
    setInputError(null);
    setEntering(false);
    setRevealed(false);
  }

  return (
    <Section
      title="端末間同期"
      note="ウォッチ・BB記録・メモを、同じ同期キーを入力した端末どうしで揃えます。"
    >
      <Card className="p-4 space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <p className="text-sm font-bold text-text">状態</p>
          {hydrated ? (
            <Chip tone={chip.tone}>
              <span className="tabular-nums">{chip.label}</span>
            </Chip>
          ) : null}
        </div>

        {hydrated && key ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">同期キー</p>
            <p className="break-all rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-sm tabular-nums text-text">
              {revealed ? formatSyncKey(key) : maskSyncKey(key)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-pressed={revealed}
                className={BUTTON}
              >
                {revealed ? "隠す" : "表示"}
              </button>
              <button type="button" onClick={copyKey} className={BUTTON}>
                {copied ? "コピーしました" : "コピー"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={busy}
              className={`${PRIMARY_BUTTON} w-full`}
            >
              {busy ? "同期中…" : "今すぐ同期"}
            </button>
          </div>
        ) : null}

        {hydrated && !key ? (
          <button
            type="button"
            onClick={() => void createKey()}
            className={`${PRIMARY_BUTTON} w-full`}
          >
            同期キーを作成
          </button>
        ) : null}

        {hydrated ? (
          entering ? (
            <form onSubmit={submitKey} className="space-y-2">
              <label htmlFor="sync-key-input" className="block text-xs text-muted">
                別の端末の「同期キー」を入力（ハイフン・空白はあってもなくても可）
              </label>
              <input
                id="sync-key-input"
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setInputError(null);
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-…"
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 font-mono text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              />
              {inputError ? <p className="text-xs text-down">{inputError}</p> : null}
              <p className="text-xs text-muted">
                入力したキーの記録とこの端末の記録をまとめます（同じ項目はこの端末の内容が残ります）。
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="submit" disabled={input.trim() === ""} className={PRIMARY_BUTTON}>
                  このキーで同期
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntering(false);
                    setInput("");
                    setInputError(null);
                  }}
                  className={BUTTON}
                >
                  キャンセル
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setEntering(true)} className={`${BUTTON} w-full`}>
              別の端末のキーを入力
            </button>
          )
        ) : null}

        {hydrated && key ? (
          confirmingDisconnect ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                この端末の同期を止めます。ウォッチ・BB記録・メモはこの端末に残ります。
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    setConfirmingDisconnect(false);
                    setRevealed(false);
                  }}
                  className="min-h-11 rounded-xl border border-down/30 bg-down/15 px-4 text-sm font-semibold text-down active:opacity-80"
                >
                  解除する
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  className={BUTTON}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(true)}
              className={`${BUTTON} w-full`}
            >
              同期を解除
            </button>
          )
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        ) : null}

        <p className="border-t border-border pt-3 text-xs text-warn">
          キーを知っている人は同じ記録を読み書きできます。他人に共有しないでください。
        </p>
      </Card>
    </Section>
  );
}
