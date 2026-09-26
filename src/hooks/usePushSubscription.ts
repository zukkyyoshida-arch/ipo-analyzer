"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base64UrlToBytes } from "@/lib/push/base64url";
import { PUSH_EVENT_KINDS } from "@/lib/push/notify";
import { MAX_WATCHED_CODES } from "@/lib/push/subscription";

// Web Push の購読状態と登録・解除。購読情報はサーバー（KV）で持ち、localStorage は使わない。

/** unsupported: 非対応ブラウザ / needs-standalone: iOS でホーム画面追加前 / supported: 利用可。 */
export type PushSupport = "checking" | "unsupported" | "needs-standalone" | "supported";
export type PushPermission = NotificationPermission | "unsupported";

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ は Mac と同じ UA のため、タッチ対応かどうかで補う。
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** ホーム画面から起動しているか（display-mode: standalone または iOS の navigator.standalone）。 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

function detectSupport(): PushSupport {
  if (typeof window === "undefined") return "checking";
  // iOS はホーム画面に追加して起動したときだけ Push API が使える。
  if (isIos() && !isStandalone()) return "needs-standalone";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return "supported";
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // 開発環境などで未登録なら登録してから使う。
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

function errorMessageForStatus(status: number): string {
  if (status === 503) return "通知サーバーが準備中のため登録できませんでした。時間をおいて再度お試しください。";
  if (status === 400) return "登録内容を確認できませんでした。いったんオフにしてから再度お試しください。";
  return `通知の登録に失敗しました（${status}）。時間をおいて再度お試しください。`;
}

const NETWORK_ERROR = "通信に失敗しました。電波の良い場所で再度お試しください。";

async function postSubscriber(subscription: PushSubscription, watchedCodes: string[]): Promise<void> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      enabledKinds: PUSH_EVENT_KINDS,
      watchedCodes: watchedCodes.slice(0, MAX_WATCHED_CODES),
    }),
  });
  if (!res.ok) throw new PushApiError(res.status);
}

class PushApiError extends Error {
  constructor(readonly status: number) {
    super(`push api ${status}`);
  }
}

function toMessage(error: unknown): string {
  if (error instanceof PushApiError) return errorMessageForStatus(error.status);
  if (error instanceof TypeError) return NETWORK_ERROR;
  return "通知を設定できませんでした。ブラウザの通知設定を確認してください。";
}

/**
 * プッシュ通知の購読フック。
 * @param watchedCodes 通知対象（ウォッチリストの銘柄コード）。購読中に変わるとサーバーへ再送する
 * @param watchReady ウォッチリストの読み込みが終わったか（未読込の空配列で上書きしないため）
 */
export function usePushSubscription(watchedCodes: string[], watchReady = true) {
  const [support, setSupport] = useState<PushSupport>("checking");
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);
  // 既存の購読を取得した直後か。true のとき、次にウォッチリストが読み込み済みになった時点の
  // watchedCodes を「送信済み」とみなして記録する（設定画面を開くたびに再送しないため）。
  const adoptBaselineRef = useRef(false);

  // マウント後に端末の対応状況と既存の購読を読む（外部システムとの同期）。
  useEffect(() => {
    let cancelled = false;
    const detected = detectSupport();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(detected);
    if ("Notification" in window) setPermission(Notification.permission);
    if (detected !== "supported") return;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => {
        if (cancelled) return;
        subscriptionRef.current = sub;
        adoptBaselineRef.current = sub !== null;
        setSubscribed(sub !== null);
      })
      .catch(() => {
        // 取得できなければ未購読として扱う。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 購読中にウォッチリストが変わったら通知対象をサーバーへ再送する。
  const codesKey = [...watchedCodes].sort().join(",");
  const lastSentRef = useRef<string | null>(null);
  useEffect(() => {
    const sub = subscriptionRef.current;
    if (!subscribed || !sub || !watchReady) return;
    if (adoptBaselineRef.current) {
      // 購読状態の取得時点の watchedCodes は登録済みとして扱い、ここでは送らない。
      adoptBaselineRef.current = false;
      lastSentRef.current = codesKey;
      return;
    }
    if (lastSentRef.current === codesKey) return;
    const timer = window.setTimeout(() => {
      postSubscriber(sub, codesKey ? codesKey.split(",") : [])
        .then(() => {
          lastSentRef.current = codesKey;
        })
        .catch((e: unknown) => setError(toMessage(e)));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [subscribed, codesKey, watchReady]);

  const subscribe = useCallback(async () => {
    if (support !== "supported") return;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setError(
          result === "denied"
            ? "通知がブロックされています。端末またはブラウザの設定から許可してください。"
            : "通知が許可されませんでした。",
        );
        return;
      }
      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new PushApiError(keyRes.status);
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const reg = await getRegistration();
      if (!reg) throw new Error("service worker unavailable");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      try {
        await postSubscriber(sub, watchedCodes);
      } catch (e) {
        // サーバー登録に失敗したら端末側の購読も戻して状態を揃える。
        await sub.unsubscribe().catch(() => undefined);
        throw e;
      }
      subscriptionRef.current = sub;
      adoptBaselineRef.current = false;
      lastSentRef.current = [...watchedCodes].sort().join(",");
      setSubscribed(true);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }, [support, watchedCodes]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sub = subscriptionRef.current;
      if (sub) {
        const res = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        // サーバー側の削除に失敗しても端末側の購読は解除する（失効扱いで後日 KV から消える）。
        if (!res.ok && res.status !== 503) setError(errorMessageForStatus(res.status));
        await sub.unsubscribe();
      }
      subscriptionRef.current = null;
      adoptBaselineRef.current = false;
      lastSentRef.current = null;
      setSubscribed(false);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { support, permission, subscribed, busy, error, subscribe, unsubscribe };
}
