import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// 注: initOpenNextCloudflareForDev() はここでは呼ばない。
// これは `next dev` でCloudflare bindings（KV/R2/Durable Objects等）を
// ローカル再現するための開発体験補助。コード側で bindings を参照するのは
// /api/push/*（getCloudflareContext で KV の PUSH_SUBSCRIPTIONS を参照）だけで、
// `next dev` では KV が無いため 503 を返す設計にしている。通知まわりの動作確認は
// `npm run preview`（wrangler のローカル Workers ランタイム）で行う。
