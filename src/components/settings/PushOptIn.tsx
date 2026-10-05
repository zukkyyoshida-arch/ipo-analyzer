"use client";

import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { Section } from "@/components/ui/Section";
import { useWatchlist } from "@/hooks/useUserData";
import { usePushSubscription, type PushPermission } from "@/hooks/usePushSubscription";
import { PUSH_EVENT_KINDS, PUSH_EVENT_LABELS } from "@/lib/push/notify";

const PERMISSION_CHIP: Record<PushPermission, { tone: ChipTone; label: string }> = {
  granted: { tone: "up", label: "許可済み" },
  default: { tone: "neutral", label: "未確認" },
  denied: { tone: "down", label: "ブロック中" },
  unsupported: { tone: "neutral", label: "未対応" },
};

/**
 * プッシュ通知の設定セクション。通知対象はウォッチリストの銘柄のみ（v1 は固定）。
 * iOS はホーム画面に追加して開いたときだけ有効化でき、それ以外はトグルを無効にして案内だけ出す。
 */
export function PushOptIn() {
  const { watchlist, hydrated } = useWatchlist();
  const { support, permission, subscribed, busy, error, subscribe, unsubscribe } =
    usePushSubscription(watchlist, hydrated);

  const chip = PERMISSION_CHIP[support === "supported" ? permission : "unsupported"];
  const disabled =
    busy || support !== "supported" || (permission === "denied" && !subscribed);
  const blocked = support === "supported" && permission === "denied";
  const on = subscribed && support === "supported";

  return (
    <Section
      title="プッシュ通知"
      note="BB開始・抽選・購入期限・ロックアップ解除などの予定を毎朝8時ごろにお知らせします（参考情報）。"
    >
      <Card className="p-4 space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">通知を受け取る</p>
            <div className="mt-1">
              <Chip tone={chip.tone}>通知の許可: {chip.label}</Chip>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="プッシュ通知を受け取る"
            disabled={disabled}
            onClick={() => (on ? unsubscribe() : subscribe())}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center active:opacity-80 disabled:opacity-40"
          >
            <span
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                on ? "border-accent bg-accent" : "border-border bg-surface-2"
              }`}
            >
              <span
                className={`absolute h-5 w-5 rounded-full transition-transform ${
                  on ? "translate-x-6 bg-on-accent" : "translate-x-1 bg-muted"
                }`}
              />
            </span>
          </button>
        </div>

        {support === "needs-standalone" ? (
          <div>
            <p className="text-xs text-muted">iOSではホーム画面に追加後のみ通知を許可できます。</p>
            <Disclosure summary="手順を見る" muted>
              <p className="pb-2 text-xs text-muted">
                下の「アプリとして使う」の手順で追加し、ホーム画面のアイコンから開いてください。
              </p>
            </Disclosure>
          </div>
        ) : null}
        {support === "unsupported" ? (
          <p className="text-xs text-muted">このブラウザは通知に対応していません。</p>
        ) : null}
        {blocked ? (
          <div>
            <p className="text-xs text-muted">通知がブロックされています。</p>
            <Disclosure summary="許可に変える手順を見る" muted>
              <p className="pb-2 text-xs text-muted">
                端末の設定（通知）またはブラウザのサイト設定から許可に変更すると、ここでオンにできます。
              </p>
            </Disclosure>
          </div>
        ) : null}

        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted">
            通知対象: ウォッチリストの銘柄（「中長期の新規候補」だけは全銘柄が対象）
            {hydrated ? <span className="tabular-nums">（{watchlist.length}銘柄）</span> : null}
          </p>
          {hydrated && watchlist.length === 0 && support === "supported" && !blocked ? (
            <p className="mt-1 text-xs text-warn">
              ウォッチリストが空のため、現在は通知が届きません。銘柄ページからウォッチに追加できます。
            </p>
          ) : null}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {PUSH_EVENT_KINDS.map((kind) => (
              <li key={kind}>
                <Chip>{PUSH_EVENT_LABELS[kind]}</Chip>
              </li>
            ))}
          </ul>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        ) : null}
      </Card>
    </Section>
  );
}
