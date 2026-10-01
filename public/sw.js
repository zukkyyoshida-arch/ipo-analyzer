// カブレーダー 手書き Service Worker（Serwist/next-pwa 未使用）。
// 方針:
// - install: app shell（主要ルート＋manifest＋アイコン）をキャッシュ
// - fetch（ナビゲーション）: ネットワーク優先、失敗時はキャッシュ→/offline
// - fetch（/_next/static/ 等の静的アセット）: キャッシュ優先
// - fetch（/api/）: キャッシュしない（常にネットワーク）

const CACHE_VERSION = "v4";
const CACHE_NAME = `kabu-radar-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/ipos",
  "/screener",
  "/bb",
  "/settings",
  "/events",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((url) =>
            cache.add(url).catch(() => {
              // 個別URLの取得失敗はinstall全体を失敗させない。
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API はキャッシュしない。
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // ナビゲーション（HTML）: ネットワーク優先、失敗時キャッシュ→/offline。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match("/offline");
          return offline ?? Response.error();
        }),
    );
    return;
  }

  // 静的アセット（/_next/static/ 等）: キャッシュ優先。
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
    return;
  }
});

// ---------------------------------------------------------------------------
// Web Push（push-p2 追記）。payload は { title, body, url, kind, code } の JSON。
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "カブレーダー";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.kind && data.code ? `${data.kind}-${data.code}` : undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );
  // 同一オリジン以外へは遷移しない。
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
