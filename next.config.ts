import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // プリフェッチのインライン化（Next 16.3 から既定で有効）を切る。
    // 有効のままだと、ビルド時に書き出す .rsc のルートツリーに「ヒント未確定」の印
    // （PrefetchHint.InliningHintsStale）が残る。OpenNext のキャッシュ横取り
    // （open-next.config.ts の enableCacheInterception）はインライン化が有効だと
    // セグメント単位の応答（/_tree）を返さず、この .rsc をそのまま返す。ブラウザは
    // 受け取ったルートを即座に期限切れ扱いにして同じ URL を取り直すため、画面内の
    // リンクごとにプリフェッチが途切れなく繰り返される（2026-09-28 に約3時間で
    // 約116万リクエストとなり Workers の無料枠を使い切った）。
    // 無効にすると .rsc に印が付かず、OpenNext もセグメント単位で返すので一度で止まる。
    prefetchInlining: false,
  },
};

export default nextConfig;

// 注: initOpenNextCloudflareForDev() はここでは呼ばない。
// これは `next dev` でCloudflare bindings（KV/R2/Durable Objects等）を
// ローカル再現するための開発体験補助。コード側で bindings を参照するのは
// /api/push/*（getCloudflareContext で KV の PUSH_SUBSCRIPTIONS を参照）だけで、
// `next dev` では KV が無いため 503 を返す設計にしている。通知まわりの動作確認は
// `npm run preview`（wrangler のローカル Workers ランタイム）で行う。
